import { getInput, getBooleanInput, error, info, setOutput, setFailed } from '@actions/core'
import { getOctokit, context } from '@actions/github'
import fs from 'fs'
import { CodeOwnersEntry, parse } from 'codeowners-utils'
import { Context } from '@actions/github/lib/context'
import { Api } from '@octokit/plugin-rest-endpoint-methods/dist-types/types'
import { ActionOptions, PullRequestInformation, Assignees } from './types'

export const validPaths = ['CODEOWNERS', '.github/CODEOWNERS', 'docs/CODEOWNERS']

export const setup = (): ActionOptions => {
  const toAssign = getInput('reviewers-to-assign', { required: true })
  const reviewers = Number.parseInt(toAssign)
  const assignFromChanges = getBooleanInput('assign-from-changed-files')

  const token = process.env['GITHUB_TOKEN']
  if (!token) {
    error(`Did not find a GITHUB_TOKEN in the environment.`)
    process.exit(1)
  }

  const octokit = getOctokit(token)

  return {
    reviewers,
    assignFromChanges,
    octokit,
  }
}

const stringify = (input?: unknown) => JSON.stringify(input)
export const extractPullRequestPayload = (context: Context) => {
  const {
    payload: { pull_request: payload },
    repo: { repo, owner },
  } = context

  return payload && repo && owner
    ? {
        number: payload.number,
        repo,
        owner,
      }
    : undefined
}

const validatePullRequest = (pullRequest?: PullRequestInformation) => {
  if (!pullRequest) {
    error("Pull Request payload was not found. Is the action triggered by the 'pull-request' event?")
    process.exit(1)
  }
  return pullRequest
}

export const extractAssigneeCount = (pullRequest: PullRequestInformation) => async (octokit: Api) => {
  const { owner, repo } = pullRequest

  const currentReviewers = await octokit.rest.pulls.listRequestedReviewers({
    owner,
    repo,
    pull_number: pullRequest.number,
  })
  const {
    data: { teams, users },
  } = currentReviewers
  info('Found assigned reviewer teams:')
  const teamNames = teams.map(team => team.name)
  info(stringify(teamNames))
  info('Found assigned reviewer users:')
  const userNames = users.map(user => user.login)
  info(stringify(userNames))

  return teams.length + users.length
}

export const extractChangedFiles =
  (assignFromChanges: boolean) => async (pullRequest: PullRequestInformation, octokit: Api) => {
    if (!assignFromChanges) return []

    const { owner, repo, number } = pullRequest

    const { data: changedFiles } = await octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: number,
    })

    const filenames = changedFiles.map(file => file.filename)
    info('Found PR files:')
    info(stringify(filenames))

    return filenames
  }

export const selectReviewers = (
  assigned: number,
  reviewers: number,
  filesChanged: string[],
  codeowners: CodeOwnersEntry[],
) => {
  const randomize = <T>(input?: T[]) => input?.sort(() => Math.random() - 0.5)

  const teams = new Set<string>()
  const users = new Set<string>()

  const assignees = () => teams.size + users.size + assigned

  const stack = JSON.parse(JSON.stringify(codeowners)) as CodeOwnersEntry[] //Poor man's deep clone.
  const randomGlobalCodeowners = randomize(stack.find(owner => owner.pattern === '*')?.owners)

  while (assignees() < reviewers) {
    const randomFile = randomize(filesChanged)?.[0]
    const randomFileOwner = randomize(stack.find(owner => owner.pattern === randomFile)?.owners)?.shift()
    const selected = randomFileOwner ?? randomGlobalCodeowners?.shift()

    if (!selected) break

    const isTeam = /@.*\//.test(selected)
    isTeam ? teams.add(selected) : users.add(selected)
  }

  return {
    count: assignees(),
    teams: Array.from(teams),
    users: Array.from(users),
  }
}

export const assignReviewers = (pullRequest: PullRequestInformation, reviewers: Assignees) => async (octokit: Api) => {
  const { repo, owner, number } = pullRequest
  const { teams, users } = reviewers
  const assigned = await octokit.rest.pulls.requestReviewers({
    owner,
    repo,
    pull_number: number,
    team_reviewers: teams,
    reviewers: users,
  })
  const requestedReviewers = assigned.data.requested_reviewers?.map(user => user.login)
  const requestedTeams = assigned.data.requested_teams?.map(team => team.name)

  if (requestedReviewers && requestedTeams) {
    const requested: Assignees = {
      count: requestedReviewers.length + requestedTeams.length,
      teams: requestedTeams,
      users: requestedReviewers,
    }

    info('Assigned reviewers: ')
    info(stringify(requested))
    return requested
  }

  return undefined
}

export const run = async () => {
  try {
    const { assignFromChanges, reviewers, octokit } = setup()

    const codeownersLocation = validPaths.find(path => fs.existsSync(path))
    if (!codeownersLocation) {
      error(`Did not find a CODEOWNERS file in: ${stringify(validPaths)}.`)
      process.exit(1)
    }
    info(`Found CODEOWNERS at ${codeownersLocation}`)

    const pullRequest = validatePullRequest(extractPullRequestPayload(context))

    const filesChanged = await extractChangedFiles(assignFromChanges)(pullRequest, octokit)
    const codeowners = parse(codeownersLocation)
    info('Parsed CODEOWNERS:')
    info(stringify(codeowners))

    const assignedReviewers = await extractAssigneeCount(pullRequest)(octokit)
    if (assignedReviewers > reviewers) {
      info(`Saw ${assignedReviewers} assigned reviewers - skipping CODEOWNERS assignment.`)
      process.exit(0)
    }

    const selected = selectReviewers(assignedReviewers, reviewers, filesChanged, codeowners)
    info(`Selected reviewers for assignment: ${stringify(selected)}`)

    const assigned = await assignReviewers(pullRequest, selected)(octokit)
    if (!assigned) {
      error(`Failed to assign reviewers: ${stringify(selected)}`)
      process.exit(1)
    }

    setOutput('assigned-codeowners', stringify(assigned))
    info(`Assigned reviewers: ${stringify(assigned)}`)
  } catch (error: unknown) {
    setFailed(error as Error)
  }
}

run()

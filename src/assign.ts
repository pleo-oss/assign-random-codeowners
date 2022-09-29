import { getInput, error, info, setOutput, setFailed } from '@actions/core'
import { getOctokit, context } from '@actions/github'
import { existsSync, promises as fs } from 'fs'
import { CodeOwnersEntry, parse } from 'codeowners-utils'
import { Context } from '@actions/github/lib/context'
import { Api } from '@octokit/plugin-rest-endpoint-methods/dist-types/types'
import { ActionOptions, PullRequestInformation, Assignees, SelectionOptions } from './types'

export const validPaths = ['CODEOWNERS', '.github/CODEOWNERS', 'docs/CODEOWNERS']

export const setup = (): ActionOptions => {
  const toAssign = getInput('reviewers-to-assign', { required: true })
  const reviewers = Number.parseInt(toAssign)
  const assignFromChanges =
    getInput('assign-from-changed-files') === 'true' || getInput('assign-from-changed-files') === 'True'
  const assignIndividuals =
    getInput('assign-individuals-from-teams') === 'true' || getInput('assign-individuals-from-teams') === 'True'

  const token = process.env['GITHUB_TOKEN']
  if (!token) {
    error(`Did not find a GITHUB_TOKEN in the environment.`)
    process.exit(1)
  }

  const octokit = getOctokit(token)

  return {
    reviewers,
    assignFromChanges,
    assignIndividuals,
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

export const extractAssigneeCount = (pullRequest: PullRequestInformation) => async (octokit: Api) => {
  const { owner, repo, number: pull_number } = pullRequest

  info(`Requesting current reviewers in PR #${pull_number} via the GitHub API.`)
  const {
    data: { teams, users },
    status,
  } = await octokit.rest.pulls.listRequestedReviewers({
    owner,
    repo,
    pull_number,
  })

  info(`[${status}] Found assigned reviewer teams:`)
  const teamNames = teams.map(team => team.name)
  info(stringify(teamNames))
  info(`[${status}] Found assigned reviewer users:`)
  const userNames = users.map(user => user.login)
  info(stringify(userNames))

  return teams.length + users.length
}

export const extractChangedFiles =
  (assignFromChanges: boolean, pullRequest: PullRequestInformation) => async (octokit: Api) => {
    if (!assignFromChanges) return []

    const { owner, repo, number: pull_number } = pullRequest

    info(`Requesting files changed in PR #${pull_number} via the GitHub API.`)
    const { data: changedFiles, status } = await octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number,
    })

    const filenames = changedFiles.map(file => file.filename)
    info(`[${status}] Found changed PR files:`)
    info(stringify(filenames))

    return filenames
  }

const randomize = <T>(input?: T[]) => input?.sort(() => Math.random() - 0.5)

export const randomTeamAssignee = (organisation: string, teamSlug: string) => async (octokit: Api) => {
  info(`Requesting team members for team '${organisation}/${teamSlug}' via the GitHub API.`)
  const { data: teamMembers, status } = await octokit.rest.teams.listMembersInOrg({
    org: organisation,
    team_slug: teamSlug,
  })
  info(`[${status}] Found team members:`)
  info(stringify(teamMembers))

  const teamMemberIds = teamMembers.map(member => member.login)
  const randomized = randomize(teamMemberIds)?.[0]

  if (!randomized) {
    error(`Failed to select random team members for team '${organisation}/${teamSlug}'.`)
    process.exit(1)
  }

  return randomized
}

export const selectReviewers = async (
  changedFiles: string[],
  codeowners: CodeOwnersEntry[],
  randomTeamAssignee: (teamSlug: string) => Promise<string>,
  options: SelectionOptions,
) => {
  const { assignedReviewers, reviewers, assignIndividuals } = options

  const teams = new Set<string>()
  const users = new Set<string>()

  const assignees = () => teams.size + users.size + assignedReviewers

  const stack = JSON.parse(JSON.stringify(codeowners)) as CodeOwnersEntry[] //Poor man's deep clone.
  const randomGlobalCodeowners = randomize(stack.find(owner => owner.pattern === '*')?.owners)

  while (assignees() < reviewers) {
    const randomFile = randomize(changedFiles)?.[0]
    const randomFileOwner = randomize(stack.find(owner => owner.pattern === randomFile)?.owners)?.shift()
    const selected = randomFileOwner ?? randomGlobalCodeowners?.shift()

    if (!selected) break

    const isTeam = /@.*\//.test(selected)
    const teamSlug = selected.replace(/@.*\//, '')
    if (isTeam && assignIndividuals) {
      const selectedTeamMember = await randomTeamAssignee(teamSlug)
      info(`Assigning '${stringify(selectedTeamMember)}' from assignee team '${teamSlug}'.`)
      users.add(selectedTeamMember)
    } else if (isTeam) {
      info(`Assigning '${selected}' as an assignee team.`)
      teams.add(teamSlug)
    } else {
      info(`Assigning '${selected}' as an assignee user.`)
      users.add(selected)
    }
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

  info('Requesting reviewers via the GitHub API.')
  const { data: assigned, status } = await octokit.rest.pulls.requestReviewers({
    owner,
    repo,
    pull_number: number,
    team_reviewers: teams,
    reviewers: users,
  })

  const requestedReviewers = assigned.requested_reviewers?.map(user => user.login)
  const requestedTeams = assigned.requested_teams?.map(team => team.name)

  if (requestedReviewers && requestedTeams) {
    const requested: Assignees = {
      count: requestedReviewers.length + requestedTeams.length,
      teams: requestedTeams,
      users: requestedReviewers,
    }

    info(`[${status}] Assigned reviewers: `)
    info(stringify(requested))
    return requested
  }

  return undefined
}

export const run = async () => {
  if (process.env['CI_TEST']) return

  try {
    const { assignFromChanges, reviewers, assignIndividuals, octokit } = setup()

    const codeownersLocation = validPaths.find(path => existsSync(path))
    if (!codeownersLocation) {
      error(`Did not find a CODEOWNERS file in: ${stringify(validPaths)}.`)
      process.exit(1)
    }
    info(`Found CODEOWNERS at ${codeownersLocation}`)

    const pullRequest = extractPullRequestPayload(context)
    if (!pullRequest) {
      error("Pull Request payload was not found. Is the action triggered by the 'pull-request' event?")
      process.exit(1)
    }

    const codeownersContents = await fs.readFile(codeownersLocation, { encoding: 'utf-8' })
    const codeowners = parse(codeownersContents)
    info('Parsed CODEOWNERS:')
    info(stringify(codeowners))

    const assignedReviewers = await extractAssigneeCount(pullRequest)(octokit)
    if (assignedReviewers > reviewers) {
      info(`Saw ${assignedReviewers} assigned reviewers - skipping CODEOWNERS assignment.`)
      process.exit(0)
    }

    const assigneeSelection = async (teamSlug: string) => randomTeamAssignee(pullRequest.owner, teamSlug)(octokit)
    const selectionOptions = { assignedReviewers, reviewers, assignIndividuals }
    const changedFiles = await extractChangedFiles(assignFromChanges, pullRequest)(octokit)
    const selected = await selectReviewers(changedFiles, codeowners, assigneeSelection, selectionOptions)
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

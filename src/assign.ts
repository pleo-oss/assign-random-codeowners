import core from '@actions/core'
import github from '@actions/github'
import fs from 'fs'
import { CodeOwnersEntry, matchFile, parse } from 'codeowners-utils'
import { Context } from '@actions/github/lib/context'

interface PullRequestInformation {
  number: number
  repo: string
  owner: string
}

interface Assignees {
  count: number
  teams: string[]
  users: string[]
}

const reviewers = Number.parseInt(core.getInput('reviewers-to-assign', { required: true }))
const assignFromChanges = core.getBooleanInput('assign-from-changed-files')
const validPaths = ['CODEOWNERS', '.github/CODEOWNERS', 'docs/CODEOWNERS']
const octokit = github.getOctokit(core.getInput('GITHUB_TOKEN'))

const stringify = (input?: unknown) => JSON.stringify(input)
const extractPullRequestPayload = (context: Context) => {
  const {
    payload: {
      pull_request: payload,
      repo: { repo, owner },
    },
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
    core.error("Pull Request payload was not found. Is the action triggered by the 'pull-request' event?")
    process.exit(1)
  }
  return pullRequest
}

const extractAssigneeCount = async (pullRequest: PullRequestInformation) => {
  const { owner, repo } = pullRequest

  const currentReviewers = await octokit.rest.pulls.listRequestedReviewers({
    owner,
    repo,
    pull_number: pullRequest.number,
  })
  core.info('Found assigned reviewer teams:')
  const teams = currentReviewers.data.teams.map(team => team.name)
  core.info(stringify(teams))
  core.info('Found assigned reviewer users:')
  const users = currentReviewers.data.users.map(user => user.login)
  core.info(stringify(users))

  return currentReviewers.data.teams.length + currentReviewers.data.users.length
}

const extractChangedFiles = async (assignFromChanges: boolean) => {
  if (!assignFromChanges) return []

  const pullRequest = validatePullRequest(extractPullRequestPayload(github.context))

  const { owner, repo } = github.context.repo
  const pullRequestNumber = pullRequest.number

  const changedFiles = await octokit.rest.pulls.listFiles({
    owner,
    repo,
    pull_number: pullRequestNumber,
  })
  const filenames = changedFiles.data.map(file => file.filename)
  core.info('Found PR files:')
  core.info(filenames.join(', '))

  return filenames
}

const selectReviewers = (assigned: number, filesChanged: string[], codeowners: CodeOwnersEntry[]) => {
  const randomize = (input?: unknown[]) => input?.sort(() => Math.random() - 0.5)

  const selectedReviewers: Assignees = {
    count: assigned,
    teams: [],
    users: [],
  }

  const randomizedFilesChanged = randomize(filesChanged) as string[]

  const globalCodeOwners = codeowners.find(owner => owner.pattern === '*')?.owners
  const randomGlobalCodeOwners = randomize(globalCodeOwners)

  while (selectedReviewers.count + assigned < reviewers) {
    const randomFile = randomizedFilesChanged.shift() ?? ''
    const fileOwner = randomize(matchFile(randomFile, codeowners)?.owners)?.shift()
    const randomCodeOwner = randomGlobalCodeOwners?.shift()
    const selected = (fileOwner ?? randomCodeOwner) as string

    if (selected) {
      const isTeam = /@.*\//.test(selected)
      isTeam ? selectedReviewers.teams.push(selected) : selectedReviewers.users.push(selected)
      selectedReviewers.count++
    }
  }

  return selectedReviewers
}

const assignReviewers = async (pullRequest: PullRequestInformation, reviewers: Assignees) => {
  const { repo, owner, number } = pullRequest
  const { teams, users } = reviewers
  const assigned = await octokit.rest.pulls.requestReviewers({
    owner,
    repo,
    pull_number: number,
    team_reviewers: teams,
    reviewers: users,
  })
  const requestedReviewers = assigned.data.requested_reviewers?.map(user => user.login) ?? []
  const requestedTeams = assigned.data.requested_teams?.map(team => team.name) ?? []
  return requestedReviewers.concat(requestedTeams)
}

const run = async () => {
  try {
    const codeownersLocation = validPaths.find(path => fs.existsSync(path))
    if (codeownersLocation === undefined) {
      core.error(`Did not find a CODEOWNERS file in either ${stringify(validPaths)}.`)
      process.exit(1)
    }
    core.info(`Found CODEOWNERS at ${codeownersLocation}`)

    const filesChanged = await extractChangedFiles(assignFromChanges)
    const parsedCodeOwners = parse(codeownersLocation)

    const pullRequest = validatePullRequest(extractPullRequestPayload(github.context))

    const assignedReviewers = await extractAssigneeCount(pullRequest)
    if (assignedReviewers > reviewers) {
      core.info(`Saw ${assignedReviewers} assigned reviewers - skipping CODEOWNERS assignment.`)
      process.exit(0)
    }

    const selected = selectReviewers(assignedReviewers, filesChanged, parsedCodeOwners)
    core.info(`Selected reviewers for assignment: ${stringify(selected)}`)

    const assigned = await assignReviewers(pullRequest, selected)
    if (assigned) {
      core.error(`Failed to assign reviewers: ${stringify(selected)}`)
      process.exit(1)
    }

    core.setOutput('assigned-codeowners', stringify(assigned))
    core.info(`Assigned reviewers: ${stringify(assigned)}`)
  } catch (error: unknown) {
    core.setFailed(error as Error)
  }
}

run()

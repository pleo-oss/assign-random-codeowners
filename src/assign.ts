import { getInput, error, info, setOutput, setFailed } from '@actions/core'
import { getOctokit, context } from '@actions/github'
import { existsSync, promises as fs } from 'fs'
import { CodeOwnersEntry, parse } from 'codeowners-utils'
import { Context } from '@actions/github/lib/context'
import { Api } from '@octokit/plugin-rest-endpoint-methods/dist-types/types'
import { ActionOptions, PullRequestInformation, Assignees, SelectionOptions, Teams } from './types'

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
const isTeam = (selected: string) => /@.*\//.test(selected)
const extractTeamSlug = (selected: string) => selected.replace(/@.*\//, '')

export const fetchTeamMembers = (organisation: string, codeowners: CodeOwnersEntry[]) => async (octokit: Api) => {
  const allTeamOwners = Array.from(new Set(codeowners.flatMap(entry => entry.owners).filter(isTeam)))

  const allTeams = await Promise.all(
    allTeamOwners.map(async team => {
      info(`Requesting team members for team '${organisation}/${team}' via the GitHub API.`)
      const { data: teamMembers, status } = await octokit.rest.teams.listMembersInOrg({
        org: organisation,
        team_slug: extractTeamSlug(team),
      })

      if (!teamMembers) {
        error(`Failed to fetch team members for team '${organisation}/${team}'.`)
        process.exit(1)
      }

      const teamMemberIds = teamMembers.map(member => member.login)
      info(`[${status}] Found team members:`)
      info(stringify(teamMemberIds))

      return { [team]: teamMemberIds }
    }),
  )

  const joined = allTeams.reduce((acc: Teams, team: Teams) => ({ ...acc, ...team }), {})
  return joined
}

export const selectReviewers = async (
  changedFiles: string[],
  codeowners: CodeOwnersEntry[],
  ownerTeams: Teams,
  options: SelectionOptions,
) => {
  const { assignedReviewers, reviewers, assignIndividuals } = options

  const selectedTeams = new Set<string>()
  const selectedUsers = new Set<string>()

  const assignees = () => selectedTeams.size + selectedUsers.size + assignedReviewers
  const randomGlobalCodeowner = (owners?: string[]) => (assignIndividuals ? owners?.[0] : owners?.shift())

  const stack = JSON.parse(JSON.stringify(codeowners)) as CodeOwnersEntry[] //Poor man's deep clone.
  const teams = ownerTeams && (JSON.parse(JSON.stringify(ownerTeams)) as Teams)
  const globalCodeowners = stack.find(owner => owner.pattern === '*')?.owners

  while (assignees() < reviewers) {
    const randomFile = randomize(changedFiles)?.[0]
    const randomFileOwner = randomize(stack.find(owner => owner.pattern === randomFile)?.owners)?.shift()
    const randomGlobalCodeowners = randomize(globalCodeowners)
    const selected = randomFileOwner ?? randomGlobalCodeowner(randomGlobalCodeowners)

    if (!selected) break

    const teamSlug = extractTeamSlug(selected)
    if (isTeam(selected) && assignIndividuals) {
      if (Object.keys(teams).length === 0) break

      const randomTeamMember = randomize(teams?.[teamSlug])?.shift()
      if (!randomTeamMember) {
        delete teams?.[teamSlug]
        continue
      }

      info(`Assigning '${randomTeamMember}' from assignee team '${teamSlug}'.`)
      selectedUsers.add(randomTeamMember)
    } else if (isTeam(selected)) {
      info(`Assigning '${selected}' as an assignee team.`)
      selectedTeams.add(teamSlug)
    } else {
      info(`Assigning '${selected}' as an assignee user.`)
      selectedUsers.add(selected)
    }
  }

  return {
    count: assignees(),
    teams: Array.from(selectedTeams),
    users: Array.from(selectedUsers),
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

    const teams = assignIndividuals ? await fetchTeamMembers(pullRequest.owner, codeowners)(octokit) : {}
    const selectionOptions = { assignedReviewers, reviewers, assignIndividuals }
    const changedFiles = await extractChangedFiles(assignFromChanges, pullRequest)(octokit)
    const selected = await selectReviewers(changedFiles, codeowners, teams, selectionOptions)
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

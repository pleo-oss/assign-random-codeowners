/* eslint-disable @typescript-eslint/no-var-requires */
import { Context } from '@actions/github/lib/context'
import {
  setup,
  extractPullRequestPayload,
  extractAssigneeCount,
  extractChangedFiles,
  assignReviewers,
  selectReviewers,
  randomTeamAssignee,
} from './assign'
import { Assignees, SelectionOptions } from './types'
import * as core from '@actions/core'
import { CodeOwnersEntry } from 'codeowners-utils'

beforeEach(() => {
  process.env['INPUT_REVIEWERS-TO-ASSIGN'] = '2'
  process.env['GITHUB_TOKEN'] = 'bla'
  process.env['INPUT_ASSIGN-FROM-CHANGED-FILES'] = 'false'
  process.env['ASSIGN-INDIVIDUALS-FROM-TEAMS'] = 'false'
})

describe('Input handling', () => {
  it('does not throw if required inputs are present', async () => {
    const exitMock = jest.spyOn(process, 'exit').mockImplementation()
    const infoMessages: string[] = []
    jest.spyOn(process.stdout, 'write').mockImplementation(s => {
      infoMessages.push(s as string)
      return true
    })

    process.env['INPUT_ASSIGN-FROM-CHANGED-FILES'] = 'false'

    setup()

    exitMock.mockRestore()
  })

  it('can parse inputs if present', async () => {
    process.env['INPUT_ASSIGN-FROM-CHANGED-FILES'] = 'false'
    process.env['INPUT_ASSIGN-INDIVIDUALS-FROM-TEAMS'] = 'false'

    const result = setup()
    expect(result).not.toBeNull()
    expect(result.assignFromChanges).toEqual(false)
    expect(result.assignIndividuals).toEqual(false)
    expect(result.reviewers).toEqual(2)
    expect(result.octokit).not.toBeNull()
  })

  it('throws if GitHub token is not present', async () => {
    const exitMock = jest.spyOn(process, 'exit').mockImplementation()
    const infoMessages: string[] = []
    jest.spyOn(process.stdout, 'write').mockImplementation(s => {
      infoMessages.push(s as string)
      return true
    })

    delete process.env['GITHUB_TOKEN']

    expect(() => setup()).toThrow()
    expect(infoMessages.some(e => /::error::.*GITHUB_TOKEN/.test(e))).toBeTruthy()
    exitMock.mockRestore()
  })

  it("throws if 'reviewers-to-assign' is not present", async () => {
    const exitMock = jest.spyOn(process, 'exit').mockImplementation()
    const infoMessages: string[] = []
    jest.spyOn(process.stdout, 'write').mockImplementation(s => {
      infoMessages.push(s as string)
      return true
    })

    delete process.env['INPUT_REVIEWERS-TO-ASSIGN']

    expect(() => setup()).toThrow()

    exitMock.mockRestore()
  })

  it("does not throw if 'assign-from-changed-files' is not present", async () => {
    const exitMock = jest.spyOn(process, 'exit').mockImplementation()
    const infoMessages: string[] = []
    jest.spyOn(process.stdout, 'write').mockImplementation(s => {
      infoMessages.push(s as string)
      return true
    })

    delete process.env['INPUT_ASSIGN-FROM-CHANGED-FILES']

    expect(() => setup()).not.toThrow()

    exitMock.mockRestore()
  })

  it("does not throw if 'assign-individuals-from-teams' is not present", async () => {
    const exitMock = jest.spyOn(process, 'exit').mockImplementation()
    const infoMessages: string[] = []
    jest.spyOn(process.stdout, 'write').mockImplementation(s => {
      infoMessages.push(s as string)
      return true
    })

    delete process.env['INPUT_ASSIGN-INDIVIDUALS-FROM-TEAMS']

    expect(() => setup()).not.toThrow()

    exitMock.mockRestore()
  })
})

describe('Payload handling', () => {
  it('can extract information from pull request payloads', () => {
    const context: Context = {
      payload: {
        pull_request: {
          number: 1,
          html_url: '',
          body: '',
        },
      },
      eventName: 'pull-request',
      sha: '1',
      ref: '1',
      workflow: 'workflow',
      action: 'action',
      actor: 'actor',
      job: 'job',
      runNumber: 1,
      runId: 1,
      apiUrl: 'https://some-url.com',
      serverUrl: 'https://some-url.com',
      graphqlUrl: 'https://some-url.com',
      issue: {
        owner: 'owner',
        repo: 'repo',
        number: 1,
      },
      repo: {
        owner: 'owner',
        repo: 'repo',
      },
    }

    const result = extractPullRequestPayload(context)
    expect(result).toEqual({
      number: 1,
      owner: 'owner',
      repo: 'repo',
    })
  })

  it('returns undefined for missing pull request payloads', () => {
    const context: Context = {
      payload: {
        issue: {
          number: 1,
        },
      },
      eventName: 'pull-request',
      sha: '1',
      ref: '1',
      workflow: 'workflow',
      action: 'action',
      actor: 'actor',
      job: 'job',
      runNumber: 1,
      runId: 1,
      apiUrl: 'https://some-url.com',
      serverUrl: 'https://some-url.com',
      graphqlUrl: 'https://some-url.com',
      issue: {
        owner: 'owner',
        repo: 'repo',
        number: 1,
      },
      repo: {
        owner: 'owner',
        repo: 'repo',
      },
    }

    const result = extractPullRequestPayload(context)
    expect(result).toBe(undefined)
  })

  it('returns undefined for missing repository information in payloads', () => {
    const context = {
      payload: {
        pull_request: {
          number: 1,
        },
      },
      repo: {
        owner: undefined,
        repo: undefined,
      },
    }

    const result = extractPullRequestPayload(context as never)
    expect(result).toBe(undefined)
  })
})

describe("Calling GitHub's API", () => {
  it('can extract assignee count from pull request payloads', async () => {
    const teams: { name: string }[] = [{ name: 'team1' }, { name: 'team2' }]
    const users: { login: string }[] = [{ login: 'login1' }, { login: 'login2' }]

    const infoMock = jest.spyOn(core, 'info').mockImplementation()

    const mockedRequest = jest.fn(() => ({
      data: {
        teams: teams,
        users: users,
      },
    }))

    const mockedOctokit = {
      rest: {
        pulls: {
          listRequestedReviewers: mockedRequest,
        },
      },
    }

    const pullRequest = {
      number: 1,
      owner: 'owner',
      repo: 'repo',
    }

    const result = await extractAssigneeCount(pullRequest)(mockedOctokit as never)

    expect(result).toEqual(teams.length + users.length)
    expect(infoMock).toHaveBeenCalledWith(JSON.stringify(teams.map(t => t.name)))
    expect(infoMock).toHaveBeenCalled()
    expect(infoMock).toHaveBeenCalledWith(JSON.stringify(users.map(t => t.login)))
  })

  it('handles missing data in pull request payloads', async () => {
    const mockedOctokit = {
      rest: {
        pulls: {
          listRequestedReviewers: jest.fn(() => {
            throw Error('💥')
          }),
        },
      },
    }

    const pullRequest = {
      number: 1,
      owner: 'owner',
      repo: 'repo',
    }

    expect(() => extractAssigneeCount(pullRequest)(mockedOctokit as never)).rejects.toBeTruthy()
  })

  it('can extract changed files if not set', async () => {
    const files = [{ filename: 'file1' }, { filename: 'file2' }]
    const filenames = files.map(f => f.filename)
    const mockedRequest = jest.fn(() => ({
      data: files,
    }))

    const mockedOctokit = {
      rest: {
        pulls: {
          listFiles: mockedRequest,
        },
      },
    }

    const pullRequest = {
      owner: 'owner',
      repo: 'repo',
      number: 1,
    }

    const infoMock = jest.spyOn(core, 'info').mockImplementation()

    const result = await extractChangedFiles(false, pullRequest as never)(mockedOctokit as never)

    expect(result).toEqual([])
    expect(infoMock).not.toHaveBeenCalledWith(filenames)
  })

  it('handles missing data in PR file payloads', async () => {
    const mockedOctokit = {
      rest: {
        pulls: {
          listFiles: async () => ({
            undefined,
          }),
        },
      },
    }

    const pullRequest = {
      number: 1,
      owner: 'owner',
      repo: 'repo',
    }

    const result = await extractChangedFiles(false, pullRequest)(mockedOctokit as never)
    expect(result).toEqual([])
  })

  it('can extract changed files if set', async () => {
    const files = [{ filename: 'file1' }, { filename: 'file2' }]
    const filenames = files.map(f => f.filename)
    const mockedRequest = jest.fn(() => ({
      data: files,
    }))

    const mockedOctokit = {
      rest: {
        pulls: {
          listFiles: mockedRequest,
        },
      },
    }

    const pullRequest = {
      owner: 'owner',
      repo: 'repo',
      number: 1,
    }

    const infoMock = jest.spyOn(core, 'info').mockImplementation()

    const result = await extractChangedFiles(true, pullRequest as never)(mockedOctokit as never)

    expect(result).toEqual(filenames)
    expect(infoMock).toHaveBeenCalledWith(JSON.stringify(filenames))
  })

  it('can assign reviewers', async () => {
    const users = [{ login: 'login1' }, { login: 'login2' }]
    const userLogins = users.map(u => u.login)
    const teams = [{ name: 'name1' }, { name: 'name2' }]
    const teamNames = teams.map(t => t.name)

    const expected = { count: userLogins.length + teamNames.length, teams: teamNames, users: userLogins }

    const assignees: Assignees = {
      count: 0,
      teams: teamNames,
      users: userLogins,
    }

    const mockedRequest = jest.fn(() => ({
      data: { requested_reviewers: users, requested_teams: teams },
    }))

    const mockedOctokit = {
      rest: {
        pulls: {
          requestReviewers: mockedRequest,
        },
      },
    }

    const pullRequest = {
      owner: 'owner',
      repo: 'repo',
      number: 1,
    }

    const infoMock = jest.spyOn(core, 'info').mockImplementation()

    const result = await assignReviewers(pullRequest, assignees)(mockedOctokit as never)
    expect(result).toEqual(expected)
    expect(infoMock).toHaveBeenCalledWith(JSON.stringify(expected))
  })

  it('can extract team members from team slug', async () => {
    const teamMembers = ['teamMember1', 'teamMember2']
    const mockedOctokit = {
      rest: {
        teams: {
          listMembersInOrg: () => ({
            data: [{ login: teamMembers[0] }, { login: teamMembers[1] }],
          }),
        },
      },
    }

    const result = await randomTeamAssignee('', '')(mockedOctokit as never)
    expect(teamMembers.some(member => member === result)).toBeTruthy()
  })

  it('handles missing data in pull request payloads', async () => {
    const exitMock = jest.spyOn(process, 'exit').mockImplementation()
    const infoMessages: string[] = []

    jest.spyOn(process.stdout, 'write').mockImplementation(s => {
      infoMessages.push(s as string)
      return true
    })

    const mockedOctokit = {
      rest: {
        teams: {
          listMembersInOrg: () => ({
            data: [],
          }),
        },
      },
    }

    await randomTeamAssignee('', '')(mockedOctokit as never)
    expect(exitMock).toHaveBeenCalled()
    expect(infoMessages.some(e => /::error::.*Failed to select/.test(e))).toBeTruthy()

    exitMock.mockRestore()
  })
})

describe('Reviewer selection', () => {
  const maxAssignees = 4

  const filesChanged = ['filename1', 'filename2']
  const orgTeams = ['@org/team1', '@org/team2', '@org/team3']
  const teamMembers = 'teamlogin1'
  const individuals = ['login1', 'login2']
  const reviewers = [...orgTeams, ...individuals]

  const merged = filesChanged.map(filename => ({ owners: reviewers, pattern: filename }))

  const codeowners: CodeOwnersEntry[] = [{ owners: ['globalOwner1', 'globalOwner2'], pattern: '*' }, ...merged]

  const randomTeamAssignee = async () => teamMembers

  it('does not select more than specified reviewers', async () => {
    const assigned = 4
    const expected: Assignees = {
      count: assigned,
      teams: [],
      users: [],
    }
    const options: SelectionOptions = {
      assignedReviewers: assigned,
      assignIndividuals: false,
      reviewers: maxAssignees,
    }
    const result = await selectReviewers(filesChanged, codeowners, randomTeamAssignee, options)
    expect(result).not.toBeNull()
    expect(result).toEqual(expected)
  })

  it('randomly selects from changed files', async () => {
    const assigned = 0
    const options: SelectionOptions = {
      assignedReviewers: assigned,
      assignIndividuals: false,
      reviewers: maxAssignees,
    }
    const result = await selectReviewers(filesChanged, codeowners, randomTeamAssignee, options)

    expect(result).not.toBeNull()
    expect(result.count).toEqual(4)
  })

  it('randomly selects from changed files until empty', async () => {
    const filesChanged = ['filename1']
    const teamNames = ['@org/team1', '@org/team2', '@org/team3']
    const codeowners: CodeOwnersEntry[] = [
      { owners: teamNames, pattern: filesChanged[0] },
      { pattern: '*', owners: ['globalOwner'] },
    ]
    const assigned = 0
    const options: SelectionOptions = {
      assignedReviewers: assigned,
      assignIndividuals: false,
      reviewers: maxAssignees,
    }
    const result = await selectReviewers(filesChanged, codeowners, randomTeamAssignee, options)

    expect(result).not.toBeNull()
    expect(result.count).toEqual(4)
    expect(result.teams.every(name => teamNames.map(t => t.replace(/@.*\//, '')).includes(name))).toBeTruthy()
    expect(result.users).toEqual(['globalOwner'])
  })

  it('randomly selects from global CODEOWNERS', async () => {
    const owners = ['globalOwner1', 'globalOwner2', 'globalOwner3']
    const filesChanged = []
    const codeowners: CodeOwnersEntry[] = [{ pattern: '*', owners: owners }]
    const assigned = 0
    const options: SelectionOptions = {
      assignedReviewers: assigned,
      assignIndividuals: false,
      reviewers: maxAssignees,
    }

    const result = await selectReviewers(filesChanged, codeowners, randomTeamAssignee, options)

    expect(result).not.toBeNull()
    expect(result.count).toEqual(3)
    expect(result.users.every(name => owners.includes(name))).toBeTruthy()
  })

  it('handles empty CODEOWNERS', async () => {
    const assigned = 0
    const options: SelectionOptions = {
      assignedReviewers: assigned,
      assignIndividuals: false,
      reviewers: maxAssignees,
    }

    const result = await selectReviewers(filesChanged, [], randomTeamAssignee, options)

    expect(result).toEqual({ count: 0, teams: [], users: [] })
  })
})

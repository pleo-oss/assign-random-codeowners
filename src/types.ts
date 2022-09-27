import { Api } from '@octokit/plugin-rest-endpoint-methods/dist-types/types'

export interface ActionOptions {
  reviewers: number
  assignFromChanges: boolean
  octokit: Api
}

export interface PullRequestInformation {
  number: number
  repo: string
  owner: string
}

export interface Assignees {
  count: number
  teams: string[]
  users: string[]
}

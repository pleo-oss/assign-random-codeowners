import { Api } from '@octokit/plugin-rest-endpoint-methods/dist-types/types'

export interface ActionOptions {
  reviewers: number
  assignFromChanges: boolean
  assignIndividuals: boolean
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

export interface SelectionOptions {
  assignedReviewers: number
  reviewers: number
  assignIndividuals: boolean
}

export interface TeamMembers {
  [teamName: string]: string[]
}

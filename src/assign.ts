import core from '@actions/core';
import github from '@actions/github';
import fs from 'fs';
import { Octokit } from '@octokit/core';
import { Api } from '@octokit/plugin-rest-endpoint-methods/dist-types/types';
import { CodeOwnersEntry, matchFile, parse } from 'codeowners-utils'
import { Context } from '@actions/github/lib/context';
const reviewers = Number.parseInt(core.getInput('reviewers-to-assign', { required: true }))
const assignFromChanges = core.getBooleanInput('assign-from-changed-files')
const validPaths = ['CODEOWNERS', '.github/CODEOWNERS', 'docs/CODEOWNERS']

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

const stringify = (input?: unknown) => JSON.stringify(input)
    
async function run() {
    try {
        const octokit = github.getOctokit(core.getInput("GITHUB_TOKEN"))
        
        const codeownersLocation = validPaths.find(path => fs.existsSync(path))
        if (!codeownersLocation) {
            core.error(`Did not find a CODEOWNERS file in either ${stringify(validPaths)}.`)
            process.exit(1)
        }
        core.info(`Found CODEOWNERS at ${codeownersLocation}`)
        
        const filesChanged = await extractChangedFiles(assignFromChanges, octokit)
        const parsedCodeOwners = parse(codeownersLocation)

        const pullRequestInformation = extractPullRequestPayload(github.context)
        if (!pullRequestInformation) {
            core.error("Pull Request payload was not found. Is the action triggered by the 'pull-request' event?")
            process.exit(1)
        }

        const assignedReviewers = await extractAssigneeCount(pullRequestInformation, octokit)
        if (assignedReviewers > reviewers) {
            core.info(`Saw ${assignedReviewers} assigned reviewers - skipping CODEOWNERS assignment.`)
            process.exit(0)
        }
        
        const selected = await selectReviewers(assignedReviewers, filesChanged, parsedCodeOwners)
        core.info(`Selected reviewers for assignment: ${stringify(selected)}`)
        const assigned = await assignReviewers(pullRequestInformation, selected, octokit)
        if (!assigned) {
            core.error(`Failed to assign reviewers: ${stringify(selected)}`)
            process.exit(1)
        }
        core.setOutput("assigned-codeowners", stringify(assigned));
        core.info(`Assigned reviewers: ${stringify(assigned)}`)
    } catch (error: any) {
        core.setFailed(error.message);
    }
}

function extractPullRequestPayload(context: Context): PullRequestInformation | undefined {
    const { payload: { pull_request: payload } } = context
    if (!payload) return undefined

    const {repo, owner} = context.payload
    return {
        number: payload?.number,
        repo,
        owner
    }
}

async function extractAssigneeCount(pullRequestInformation: PullRequestInformation, octokit: Octokit & Api) {
    const { owner, repo } = github.context.repo

    const currentReviewers = await octokit.rest.pulls.listRequestedReviewers({ owner, repo, pull_number: pullRequestInformation.number})
    core.info("Found assigned reviewer teams:")
    const teams = currentReviewers.data.teams.map(team => team.name)
    core.info(stringify(teams))
    core.info("Found assigned reviewer users:")
    const users = currentReviewers.data.users.map(user => user.login)
    core.info(stringify(users))
    
    return currentReviewers.data.teams.length + currentReviewers.data.users.length
}

async function extractChangedFiles(assignFromChanges: boolean, octokit: Api) {
    if (!assignFromChanges) return []

    const { payload: { pull_request: pullRequestPayload } } = github.context
    if (!pullRequestPayload) {
        core.error("Pull Request payload was not found. Is the action triggered by the 'pull-request' event?")
        process.exit(1)
    }
    
    const { owner, repo } = github.context.repo
    const pullRequestNumber = pullRequestPayload.number

    const changedFiles = await octokit.rest.pulls.listFiles({ owner, repo, pull_number: pullRequestNumber})
    const filenames = changedFiles.data.map(file => file.filename)
    core.info("Found PR files:")
    core.info(filenames.join(", "))
    
    return filenames
}

const randomize = (input?: unknown[]) => input?.sort((_,__) =>  Math.random() - 0.5)

async function selectReviewers(assigned: number, filesChanged: string[], codeowners: CodeOwnersEntry[]) {
    const selectedReviewers: Assignees = {
        count: assigned,
        teams: [],
        users: []
    }
    
    const randomizedFilesChanged = randomize(filesChanged) as string[]
    
    const globalCodeOwners = codeowners.find(owner => owner.pattern === "*")?.owners
    const randomGlobalCodeOwners = randomize(globalCodeOwners)

    while (selectedReviewers.count + assigned < reviewers) {
        const randomFile = randomizedFilesChanged.shift() ?? ""
        const fileOwner = randomize(matchFile(randomFile, codeowners)?.owners)?.shift()
        const randomCodeOwner = randomGlobalCodeOwners?.shift()
        const selected = (fileOwner ?? randomCodeOwner) as string
        
        if (selected) {
            const isTeam = /@.*\//.test(selected)
            isTeam 
                ? selectedReviewers.teams.push(selected) 
                : selectedReviewers.users.push(selected)
            selectedReviewers.count++
        }
    }

    return selectedReviewers
}

async function assignReviewers(pullRequestInformation: PullRequestInformation, reviewers: Assignees, octokit: Api) {
    const {repo, owner, number} = pullRequestInformation
    const {teams, users} = reviewers
    const assigned = await octokit.rest.pulls.requestReviewers({
        owner, 
        repo, 
        pull_number: number, 
        team_reviewers: teams, 
        reviewers: users
    })
    const requestedReviewers = assigned.data.requested_reviewers?.map(user => user.login) ?? []
    const requestedTeams = assigned.data.requested_teams?.map(team => team.name) ?? []
    return requestedReviewers.concat(requestedTeams)
}

run()

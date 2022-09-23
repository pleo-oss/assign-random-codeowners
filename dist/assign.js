"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = __importDefault(require("@actions/core"));
const github_1 = __importDefault(require("@actions/github"));
const fs_1 = __importDefault(require("fs"));
const codeowners_utils_1 = require("codeowners-utils");
const reviewers = Number.parseInt(core_1.default.getInput('reviewers-to-assign', { required: true }));
const assignFromChanges = core_1.default.getBooleanInput('assign-from-changed-files');
const validPaths = ['CODEOWNERS', '.github/CODEOWNERS', 'docs/CODEOWNERS'];
const octokit = github_1.default.getOctokit(core_1.default.getInput('GITHUB_TOKEN'));
const stringify = (input) => JSON.stringify(input);
const extractPullRequestPayload = (context) => {
    const { payload: { pull_request: payload, repo: { repo, owner }, }, } = context;
    return payload && repo && owner
        ? {
            number: payload.number,
            repo,
            owner,
        }
        : undefined;
};
const extractAssigneeCount = async (pullRequest) => {
    const { owner, repo } = pullRequest;
    const currentReviewers = await octokit.rest.pulls.listRequestedReviewers({
        owner,
        repo,
        pull_number: pullRequest.number,
    });
    core_1.default.info('Found assigned reviewer teams:');
    const teams = currentReviewers.data.teams.map(team => team.name);
    core_1.default.info(stringify(teams));
    core_1.default.info('Found assigned reviewer users:');
    const users = currentReviewers.data.users.map(user => user.login);
    core_1.default.info(stringify(users));
    return currentReviewers.data.teams.length + currentReviewers.data.users.length;
};
const extractChangedFiles = async (assignFromChanges) => {
    if (!assignFromChanges)
        return [];
    const pullRequest = extractPullRequestPayload(github_1.default.context);
    if (pullRequest == null) {
        core_1.default.error("Pull Request payload was not found. Is the action triggered by the 'pull-request' event?");
        process.exit(1);
    }
    const { owner, repo } = github_1.default.context.repo;
    const pullRequestNumber = pullRequest.number;
    const changedFiles = await octokit.rest.pulls.listFiles({
        owner,
        repo,
        pull_number: pullRequestNumber,
    });
    const filenames = changedFiles.data.map(file => file.filename);
    core_1.default.info('Found PR files:');
    core_1.default.info(filenames.join(', '));
    return filenames;
};
const selectReviewers = (assigned, filesChanged, codeowners) => {
    const randomize = (input) => input?.sort(() => Math.random() - 0.5);
    const selectedReviewers = {
        count: assigned,
        teams: [],
        users: [],
    };
    const randomizedFilesChanged = randomize(filesChanged);
    const globalCodeOwners = codeowners.find(owner => owner.pattern === '*')?.owners;
    const randomGlobalCodeOwners = randomize(globalCodeOwners);
    while (selectedReviewers.count + assigned < reviewers) {
        const randomFile = randomizedFilesChanged.shift() ?? '';
        const fileOwner = randomize((0, codeowners_utils_1.matchFile)(randomFile, codeowners)?.owners)?.shift();
        const randomCodeOwner = randomGlobalCodeOwners?.shift();
        const selected = (fileOwner ?? randomCodeOwner);
        if (selected) {
            const isTeam = /@.*\//.test(selected);
            isTeam ? selectedReviewers.teams.push(selected) : selectedReviewers.users.push(selected);
            selectedReviewers.count++;
        }
    }
    return selectedReviewers;
};
const assignReviewers = async (pullRequest, reviewers) => {
    const { repo, owner, number } = pullRequest;
    const { teams, users } = reviewers;
    const assigned = await octokit.rest.pulls.requestReviewers({
        owner,
        repo,
        pull_number: number,
        team_reviewers: teams,
        reviewers: users,
    });
    const requestedReviewers = assigned.data.requested_reviewers?.map(user => user.login) ?? [];
    const requestedTeams = assigned.data.requested_teams?.map(team => team.name) ?? [];
    return requestedReviewers.concat(requestedTeams);
};
const run = async () => {
    try {
        const codeownersLocation = validPaths.find(path => fs_1.default.existsSync(path));
        if (codeownersLocation === undefined) {
            core_1.default.error(`Did not find a CODEOWNERS file in either ${stringify(validPaths)}.`);
            process.exit(1);
        }
        core_1.default.info(`Found CODEOWNERS at ${codeownersLocation}`);
        const filesChanged = await extractChangedFiles(assignFromChanges);
        const parsedCodeOwners = (0, codeowners_utils_1.parse)(codeownersLocation);
        const pullRequest = extractPullRequestPayload(github_1.default.context);
        if (!pullRequest) {
            core_1.default.error("Pull Request payload was not found. Is the action triggered by the 'pull-request' event?");
            process.exit(1);
        }
        const assignedReviewers = await extractAssigneeCount(pullRequest);
        if (assignedReviewers > reviewers) {
            core_1.default.info(`Saw ${assignedReviewers} assigned reviewers - skipping CODEOWNERS assignment.`);
            process.exit(0);
        }
        const selected = selectReviewers(assignedReviewers, filesChanged, parsedCodeOwners);
        core_1.default.info(`Selected reviewers for assignment: ${stringify(selected)}`);
        const assigned = await assignReviewers(pullRequest, selected);
        if (assigned) {
            core_1.default.error(`Failed to assign reviewers: ${stringify(selected)}`);
            process.exit(1);
        }
        core_1.default.setOutput('assigned-codeowners', stringify(assigned));
        core_1.default.info(`Assigned reviewers: ${stringify(assigned)}`);
    }
    catch (error) {
        core_1.default.setFailed(error);
    }
};
void run();

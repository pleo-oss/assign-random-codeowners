"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.run = exports.assignReviewers = exports.selectReviewers = exports.extractChangedFiles = exports.extractAssigneeCount = exports.extractPullRequestPayload = exports.setup = exports.validPaths = void 0;
const core_1 = require("@actions/core");
const github_1 = require("@actions/github");
const fs_1 = __importDefault(require("fs"));
const codeowners_utils_1 = require("codeowners-utils");
exports.validPaths = ['CODEOWNERS', '.github/CODEOWNERS', 'docs/CODEOWNERS'];
const setup = () => {
    const toAssign = (0, core_1.getInput)('reviewers-to-assign', { required: true });
    const reviewers = Number.parseInt(toAssign);
    const assignFromChanges = (0, core_1.getBooleanInput)('assign-from-changed-files');
    const token = process.env['GITHUB_TOKEN'];
    if (!token) {
        (0, core_1.error)(`Did not find a GITHUB_TOKEN in the environment.`);
        process.exit(1);
    }
    const octokit = (0, github_1.getOctokit)(token);
    return {
        reviewers,
        assignFromChanges,
        octokit,
    };
};
exports.setup = setup;
const stringify = (input) => JSON.stringify(input);
const extractPullRequestPayload = (context) => {
    const { payload: { pull_request: payload }, repo: { repo, owner }, } = context;
    return payload && repo && owner
        ? {
            number: payload.number,
            repo,
            owner,
        }
        : undefined;
};
exports.extractPullRequestPayload = extractPullRequestPayload;
const validatePullRequest = (pullRequest) => {
    if (!pullRequest) {
        (0, core_1.error)("Pull Request payload was not found. Is the action triggered by the 'pull-request' event?");
        process.exit(1);
    }
    return pullRequest;
};
const extractAssigneeCount = (pullRequest) => async (octokit) => {
    const { owner, repo } = pullRequest;
    const currentReviewers = await octokit.rest.pulls.listRequestedReviewers({
        owner,
        repo,
        pull_number: pullRequest.number,
    });
    const { data: { teams, users }, } = currentReviewers;
    (0, core_1.info)('Found assigned reviewer teams:');
    const teamNames = teams.map(team => team.name);
    (0, core_1.info)(stringify(teamNames));
    (0, core_1.info)('Found assigned reviewer users:');
    const userNames = users.map(user => user.login);
    (0, core_1.info)(stringify(userNames));
    return teams.length + users.length;
};
exports.extractAssigneeCount = extractAssigneeCount;
const extractChangedFiles = (assignFromChanges) => async (pullRequest, octokit) => {
    if (!assignFromChanges)
        return [];
    const { owner, repo, number } = pullRequest;
    const { data: changedFiles } = await octokit.rest.pulls.listFiles({
        owner,
        repo,
        pull_number: number,
    });
    const filenames = changedFiles.map(file => file.filename);
    (0, core_1.info)('Found PR files:');
    (0, core_1.info)(stringify(filenames));
    return filenames;
};
exports.extractChangedFiles = extractChangedFiles;
const selectReviewers = (assigned, reviewers, filesChanged, codeowners) => {
    const randomize = (input) => input?.sort(() => Math.random() - 0.5);
    const teams = new Set();
    const users = new Set();
    const assignees = () => teams.size + users.size + assigned;
    const stack = JSON.parse(JSON.stringify(codeowners)); //Poor man's deep clone.
    const randomGlobalCodeowners = randomize(stack.find(owner => owner.pattern === '*')?.owners);
    while (assignees() < reviewers) {
        const randomFile = randomize(filesChanged)?.[0];
        const randomFileOwner = randomize(stack.find(owner => owner.pattern === randomFile)?.owners)?.shift();
        const selected = randomFileOwner ?? randomGlobalCodeowners?.shift();
        if (!selected)
            break;
        const isTeam = /@.*\//.test(selected);
        isTeam ? teams.add(selected) : users.add(selected);
    }
    return {
        count: assignees(),
        teams: Array.from(teams),
        users: Array.from(users),
    };
};
exports.selectReviewers = selectReviewers;
const assignReviewers = (pullRequest, reviewers) => async (octokit) => {
    const { repo, owner, number } = pullRequest;
    const { teams, users } = reviewers;
    const assigned = await octokit.rest.pulls.requestReviewers({
        owner,
        repo,
        pull_number: number,
        team_reviewers: teams,
        reviewers: users,
    });
    const requestedReviewers = assigned.data.requested_reviewers?.map(user => user.login);
    const requestedTeams = assigned.data.requested_teams?.map(team => team.name);
    if (requestedReviewers && requestedTeams) {
        const requested = {
            count: requestedReviewers.length + requestedTeams.length,
            teams: requestedTeams,
            users: requestedReviewers,
        };
        (0, core_1.info)('Assigned reviewers: ');
        (0, core_1.info)(stringify(requested));
        return requested;
    }
    return undefined;
};
exports.assignReviewers = assignReviewers;
const run = async () => {
    try {
        const { assignFromChanges, reviewers, octokit } = (0, exports.setup)();
        const codeownersLocation = exports.validPaths.find(path => fs_1.default.existsSync(path));
        if (!codeownersLocation) {
            (0, core_1.error)(`Did not find a CODEOWNERS file in: ${stringify(exports.validPaths)}.`);
            process.exit(1);
        }
        (0, core_1.info)(`Found CODEOWNERS at ${codeownersLocation}`);
        const pullRequest = validatePullRequest((0, exports.extractPullRequestPayload)(github_1.context));
        const filesChanged = await (0, exports.extractChangedFiles)(assignFromChanges)(pullRequest, octokit);
        const codeowners = (0, codeowners_utils_1.parse)(codeownersLocation);
        (0, core_1.info)('Parsed CODEOWNERS:');
        (0, core_1.info)(stringify(codeowners));
        const assignedReviewers = await (0, exports.extractAssigneeCount)(pullRequest)(octokit);
        if (assignedReviewers > reviewers) {
            (0, core_1.info)(`Saw ${assignedReviewers} assigned reviewers - skipping CODEOWNERS assignment.`);
            process.exit(0);
        }
        const selected = (0, exports.selectReviewers)(assignedReviewers, reviewers, filesChanged, codeowners);
        (0, core_1.info)(`Selected reviewers for assignment: ${stringify(selected)}`);
        const assigned = await (0, exports.assignReviewers)(pullRequest, selected)(octokit);
        if (!assigned) {
            (0, core_1.error)(`Failed to assign reviewers: ${stringify(selected)}`);
            process.exit(1);
        }
        (0, core_1.setOutput)('assigned-codeowners', stringify(assigned));
        (0, core_1.info)(`Assigned reviewers: ${stringify(assigned)}`);
    }
    catch (error) {
        (0, core_1.setFailed)(error);
    }
};
exports.run = run;
(0, exports.run)();

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.run = exports.assignReviewers = exports.selectReviewers = exports.randomTeamAssignee = exports.extractChangedFiles = exports.extractAssigneeCount = exports.extractPullRequestPayload = exports.setup = exports.validPaths = void 0;
const core_1 = require("@actions/core");
const github_1 = require("@actions/github");
const fs_1 = require("fs");
const codeowners_utils_1 = require("codeowners-utils");
exports.validPaths = ['CODEOWNERS', '.github/CODEOWNERS', 'docs/CODEOWNERS'];
const setup = () => {
    const toAssign = (0, core_1.getInput)('reviewers-to-assign', { required: true });
    const reviewers = Number.parseInt(toAssign);
    const assignFromChanges = (0, core_1.getInput)('assign-from-changed-files') === 'true' || (0, core_1.getInput)('assign-from-changed-files') === 'True';
    const assignIndividuals = (0, core_1.getInput)('assign-individuals-from-teams') === 'true' || (0, core_1.getInput)('assign-individuals-from-teams') === 'True';
    const token = process.env['GITHUB_TOKEN'];
    if (!token) {
        (0, core_1.error)(`Did not find a GITHUB_TOKEN in the environment.`);
        process.exit(1);
    }
    const octokit = (0, github_1.getOctokit)(token);
    return {
        reviewers,
        assignFromChanges,
        assignIndividuals,
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
const extractAssigneeCount = (pullRequest) => async (octokit) => {
    const { owner, repo, number: pull_number } = pullRequest;
    (0, core_1.info)(`Requesting current reviewers in PR #${pull_number} via the GitHub API.`);
    const { data: { teams, users }, status, } = await octokit.rest.pulls.listRequestedReviewers({
        owner,
        repo,
        pull_number,
    });
    (0, core_1.info)(`[${status}] Found assigned reviewer teams:`);
    const teamNames = teams.map(team => team.name);
    (0, core_1.info)(stringify(teamNames));
    (0, core_1.info)(`[${status}] Found assigned reviewer users:`);
    const userNames = users.map(user => user.login);
    (0, core_1.info)(stringify(userNames));
    return teams.length + users.length;
};
exports.extractAssigneeCount = extractAssigneeCount;
const extractChangedFiles = (assignFromChanges, pullRequest) => async (octokit) => {
    if (!assignFromChanges)
        return [];
    const { owner, repo, number: pull_number } = pullRequest;
    (0, core_1.info)(`Requesting files changed in PR #${pull_number} via the GitHub API.`);
    const { data: changedFiles, status } = await octokit.rest.pulls.listFiles({
        owner,
        repo,
        pull_number,
    });
    const filenames = changedFiles.map(file => file.filename);
    (0, core_1.info)(`[${status}] Found changed PR files:`);
    (0, core_1.info)(stringify(filenames));
    return filenames;
};
exports.extractChangedFiles = extractChangedFiles;
const randomize = (input) => input?.sort(() => Math.random() - 0.5);
const randomTeamAssignee = (organisation, teamSlug) => async (octokit) => {
    (0, core_1.info)(`Requesting team members for team '${organisation}/${teamSlug}' via the GitHub API.`);
    const { data: teamMembers, status } = await octokit.rest.teams.listMembersInOrg({
        org: organisation,
        team_slug: teamSlug,
    });
    (0, core_1.info)(`[${status}] Found team members:`);
    (0, core_1.info)(stringify(teamMembers));
    const teamMemberIds = teamMembers.map(member => member.login);
    const randomized = randomize(teamMemberIds)?.[0];
    if (!randomized) {
        (0, core_1.error)(`Failed to select random team members for team '${organisation}/${teamSlug}'.`);
        process.exit(1);
    }
    return randomized;
};
exports.randomTeamAssignee = randomTeamAssignee;
const selectReviewers = async (changedFiles, codeowners, randomTeamAssignee, options) => {
    const { assignedReviewers, reviewers, assignIndividuals } = options;
    const teams = new Set();
    const users = new Set();
    const assignees = () => teams.size + users.size + assignedReviewers;
    const stack = JSON.parse(JSON.stringify(codeowners)); //Poor man's deep clone.
    const randomGlobalCodeowners = randomize(stack.find(owner => owner.pattern === '*')?.owners);
    while (assignees() < reviewers) {
        const randomFile = randomize(changedFiles)?.[0];
        const randomFileOwner = randomize(stack.find(owner => owner.pattern === randomFile)?.owners)?.shift();
        const selected = randomFileOwner ?? randomGlobalCodeowners?.shift();
        if (!selected)
            break;
        const isTeam = /@.*\//.test(selected);
        const teamSlug = selected.replace(/@.*\//, '');
        if (isTeam && assignIndividuals) {
            const selectedTeamMember = await randomTeamAssignee(teamSlug);
            (0, core_1.info)(`Assigning '${stringify(selectedTeamMember)}' from assignee team '${teamSlug}'.`);
            users.add(selectedTeamMember);
        }
        else if (isTeam) {
            (0, core_1.info)(`Assigning '${selected}' as an assignee team.`);
            teams.add(teamSlug);
        }
        else {
            (0, core_1.info)(`Assigning '${selected}' as an assignee user.`);
            users.add(selected);
        }
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
    (0, core_1.info)('Requesting reviewers via the GitHub API.');
    const { data: assigned, status } = await octokit.rest.pulls.requestReviewers({
        owner,
        repo,
        pull_number: number,
        team_reviewers: teams,
        reviewers: users,
    });
    const requestedReviewers = assigned.requested_reviewers?.map(user => user.login);
    const requestedTeams = assigned.requested_teams?.map(team => team.name);
    if (requestedReviewers && requestedTeams) {
        const requested = {
            count: requestedReviewers.length + requestedTeams.length,
            teams: requestedTeams,
            users: requestedReviewers,
        };
        (0, core_1.info)(`[${status}] Assigned reviewers: `);
        (0, core_1.info)(stringify(requested));
        return requested;
    }
    return undefined;
};
exports.assignReviewers = assignReviewers;
const run = async () => {
    if (process.env['CI_TEST'])
        return;
    try {
        const { assignFromChanges, reviewers, assignIndividuals, octokit } = (0, exports.setup)();
        const codeownersLocation = exports.validPaths.find(path => (0, fs_1.existsSync)(path));
        if (!codeownersLocation) {
            (0, core_1.error)(`Did not find a CODEOWNERS file in: ${stringify(exports.validPaths)}.`);
            process.exit(1);
        }
        (0, core_1.info)(`Found CODEOWNERS at ${codeownersLocation}`);
        const pullRequest = (0, exports.extractPullRequestPayload)(github_1.context);
        if (!pullRequest) {
            (0, core_1.error)("Pull Request payload was not found. Is the action triggered by the 'pull-request' event?");
            process.exit(1);
        }
        const codeownersContents = await fs_1.promises.readFile(codeownersLocation, { encoding: 'utf-8' });
        const codeowners = (0, codeowners_utils_1.parse)(codeownersContents);
        (0, core_1.info)('Parsed CODEOWNERS:');
        (0, core_1.info)(stringify(codeowners));
        const assignedReviewers = await (0, exports.extractAssigneeCount)(pullRequest)(octokit);
        if (assignedReviewers > reviewers) {
            (0, core_1.info)(`Saw ${assignedReviewers} assigned reviewers - skipping CODEOWNERS assignment.`);
            process.exit(0);
        }
        const assigneeSelection = async (teamSlug) => (0, exports.randomTeamAssignee)(pullRequest.owner, teamSlug)(octokit);
        const selectionOptions = { assignedReviewers, reviewers, assignIndividuals };
        const changedFiles = await (0, exports.extractChangedFiles)(assignFromChanges, pullRequest)(octokit);
        const selected = await (0, exports.selectReviewers)(changedFiles, codeowners, assigneeSelection, selectionOptions);
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

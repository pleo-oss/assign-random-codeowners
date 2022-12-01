"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.run = exports.assignReviewers = exports.selectReviewers = exports.fetchTeamMembers = exports.extractChangedFiles = exports.extractAssigneeCount = exports.extractPullRequestPayload = exports.setup = exports.validPaths = void 0;
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
    const author = payload?.['user']?.['login'];
    return payload && repo && owner
        ? {
            number: payload.number,
            repo,
            owner,
            author,
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
const isTeam = (selected) => /@.*\//.test(selected);
const extractTeamSlug = (selected) => selected.replace(/@.*\//, '');
const fetchTeamMembers = (organisation, codeowners) => async (octokit) => {
    // Ensure that we don't have duplicate IDs in order to fetch as little from GitHub as possible.
    const allTeamOwners = Array.from(new Set(codeowners.flatMap(entry => entry.owners).filter(isTeam)));
    const allTeams = await Promise.all(allTeamOwners.map(async (team) => {
        (0, core_1.info)(`Requesting team members for team '${organisation}/${team}' via the GitHub API.`);
        // Fetch members from each team since there's currently no way
        // to fetch all teams with members from a GitHub organisation.
        const { data: teamMembers, status } = await octokit.rest.teams.listMembersInOrg({
            org: organisation,
            team_slug: extractTeamSlug(team),
        });
        if (!teamMembers) {
            (0, core_1.error)(`Failed to fetch team members for team '${organisation}/${team}'.`);
            process.exit(1);
        }
        const teamMemberIds = teamMembers.map(member => member.login);
        (0, core_1.info)(`[${status}] Found team members:`);
        (0, core_1.info)(stringify(teamMemberIds));
        return { [team]: teamMemberIds };
    }));
    const joined = allTeams.reduce((acc, team) => ({ ...acc, ...team }), {});
    return joined;
};
exports.fetchTeamMembers = fetchTeamMembers;
const selectReviewers = async (changedFiles, codeowners, teamMembers, options) => {
    const { assignedReviewers, reviewers, assignIndividuals, author } = options;
    const selectedTeams = new Set();
    const selectedUsers = new Set();
    const assignees = () => selectedTeams.size + selectedUsers.size + assignedReviewers;
    const randomGlobalCodeowner = (owners) => (assignIndividuals ? owners?.[0] : owners?.shift());
    const stack = JSON.parse(JSON.stringify(codeowners)); //Poor man's deep clone.
    const teams = teamMembers && JSON.parse(JSON.stringify(teamMembers));
    const globalCodeowners = stack.find(owner => owner.pattern === '*')?.owners;
    (0, core_1.info)(`Found global CODEOWNERS: ${stringify(globalCodeowners)}.`);
    while (assignees() < reviewers) {
        const randomFile = randomize(changedFiles)?.[0];
        (0, core_1.debug)(`Selected random file: ${randomFile}`);
        const randomFileOwner = randomize(stack.find(owner => owner.pattern === randomFile)?.owners)?.shift();
        (0, core_1.debug)(`Selected random file owner: ${randomFileOwner}`);
        const randomGlobalCodeowners = randomize(globalCodeowners);
        const selected = randomFileOwner ?? randomGlobalCodeowner(randomGlobalCodeowners);
        (0, core_1.debug)(`Selected: ${selected}`);
        if (selected === author) {
            (0, core_1.debug)(`'${selected}' is the author '${author}'. Skipping.`);
            break;
        }
        if (!selected) {
            (0, core_1.debug)(`Did not find an assignee.`);
            break;
        }
        const teamSlug = extractTeamSlug(selected);
        (0, core_1.debug)(`Extracted team slug: ${teamSlug}.`);
        if (isTeam(selected) && assignIndividuals) {
            (0, core_1.debug)(`Assigning individuals from team: ${teamSlug}.`);
            (0, core_1.debug)(`Possible teams are: ${stringify(teams)}.`);
            // If the set of all teams are exhausted we give up assigning teams.
            if (Object.keys(teams).length === 0) {
                (0, core_1.debug)('Teams to assign is empty. Exiting.');
                break;
            }
            const randomTeamMember = randomize(teams?.[selected])?.shift();
            if (!randomTeamMember) {
                // Remove the team from the stack of all team members have been extracted.
                (0, core_1.debug)(`Did not find random team member. Removing team ${teamSlug} from possible teams to assign.`);
                delete teams?.[selected];
                randomGlobalCodeowners?.shift();
                continue;
            }
            (0, core_1.debug)(`Found random team member: ${randomTeamMember}.`);
            (0, core_1.info)(`Assigning '${randomTeamMember}' from assignee team '${teamSlug}'.`);
            selectedUsers.add(randomTeamMember);
        }
        else if (isTeam(selected)) {
            (0, core_1.info)(`Assigning '${selected}' as an assignee team.`);
            selectedTeams.add(teamSlug);
        }
        else {
            (0, core_1.info)(`Assigning '${selected}' as an assignee user.`);
            selectedUsers.add(selected);
        }
    }
    return {
        count: selectedTeams.size + selectedUsers.size,
        teams: Array.from(selectedTeams),
        users: Array.from(selectedUsers),
    };
};
exports.selectReviewers = selectReviewers;
const assignReviewers = (pullRequest, reviewers) => async (octokit) => {
    const { repo, owner, number } = pullRequest;
    const { teams, users, count } = reviewers;
    if (count === 0) {
        (0, core_1.info)('No reviewers were selected. Skipping requesting reviewers.');
        return reviewers;
    }
    (0, core_1.info)(`Requesting ${count} reviewers via the GitHub API.`);
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
    return reviewers;
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
        const teams = assignIndividuals ? await (0, exports.fetchTeamMembers)(pullRequest.owner, codeowners)(octokit) : {};
        const selectionOptions = { assignedReviewers, reviewers, assignIndividuals, author: pullRequest.author };
        const changedFiles = await (0, exports.extractChangedFiles)(assignFromChanges, pullRequest)(octokit);
        (0, core_1.info)('Selecting reviewers for assignment.');
        const selected = await (0, exports.selectReviewers)(changedFiles, codeowners, teams, selectionOptions);
        (0, core_1.info)(`Selected additional reviewers for assignment: ${stringify(selected)}`);
        const assigned = await (0, exports.assignReviewers)(pullRequest, selected)(octokit);
        (0, core_1.setOutput)('assigned-codeowners', stringify(assigned));
        (0, core_1.info)(`Assigned reviewers: ${stringify(assigned)}`);
    }
    catch (error) {
        (0, core_1.setFailed)(error);
    }
};
exports.run = run;
(0, exports.run)();

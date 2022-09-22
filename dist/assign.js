"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
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
function run() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const octokit = github_1.default.getOctokit(core_1.default.getInput("GITHUB_TOKEN"));
            const codeownersLocation = validPaths.find(path => fs_1.default.existsSync(path));
            if (!codeownersLocation) {
                core_1.default.error(`Did not find a CODEOWNERS file in either ${validPaths.join(", ")}.`);
                process.exit(1);
            }
            core_1.default.info(`Found CODEOWNERS at ${codeownersLocation}`);
            const filesChanged = yield determineChangedFiles(assignFromChanges, octokit);
            const parsedCodeOwners = (0, codeowners_utils_1.parse)(codeownersLocation);
            const pullRequestInformation = getPullRequestInformation(github_1.default.context);
            if (!pullRequestInformation) {
                core_1.default.error("Pull Request payload was not found. Is the action triggered by the 'pull-request' event?");
                process.exit(1);
            }
            const assignedReviewers = yield determineAssignedReviewers(pullRequestInformation, octokit);
            if (assignedReviewers > reviewers) {
                core_1.default.info(`Saw ${assignedReviewers} assigned reviewers - skipping CODEOWNERS assignment.`);
                process.exit(0);
            }
            const selected = yield selectReviewers(assignedReviewers, filesChanged, parsedCodeOwners);
            core_1.default.info(`Selected reviewers for assignment: [${selected.join(", ")}]`);
            const assigned = yield assignReviewers(pullRequestInformation, selected, octokit);
            if (!assigned) {
                core_1.default.error(`Failed to assign reviewers: ${selected.join(", ")}`);
                process.exit(1);
            }
            core_1.default.info(`Assigned reviewers: ${assigned.map(user => user.login).join(", ")}`);
        }
        catch (error) {
            core_1.default.setFailed(error.message);
        }
    });
}
function getPullRequestInformation(context) {
    const { payload: { pull_request: pullRequestPayload } } = context;
    if (!pullRequestPayload)
        return undefined;
    const { repo, owner } = context.payload;
    return {
        number: pullRequestPayload === null || pullRequestPayload === void 0 ? void 0 : pullRequestPayload.number,
        repo,
        owner
    };
}
function determineAssignedReviewers(pullRequestInformation, octokit) {
    return __awaiter(this, void 0, void 0, function* () {
        const { owner, repo } = github_1.default.context.repo;
        const currentReviewers = yield octokit.rest.pulls.listRequestedReviewers({ owner, repo, pull_number: pullRequestInformation.number });
        core_1.default.info("Found assigned reviewer teams:");
        core_1.default.info(currentReviewers.data.teams.map(team => team.name).join(", "));
        core_1.default.info("Found assigned reviewer users:");
        core_1.default.info(currentReviewers.data.users.map(user => user.login).join(", "));
        return currentReviewers.data.teams.length + currentReviewers.data.users.length;
    });
}
function determineChangedFiles(assignFromChanges, octokit) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!assignFromChanges)
            return [];
        const { payload: { pull_request: pullRequestPayload } } = github_1.default.context;
        if (!pullRequestPayload) {
            core_1.default.error("Pull Request payload was not found. Is the action triggered by the 'pull-request' event?");
            process.exit(1);
        }
        const { owner, repo } = github_1.default.context.repo;
        const pullRequestNumber = pullRequestPayload.number;
        const changedFiles = yield octokit.rest.pulls.listFiles({ owner, repo, pull_number: pullRequestNumber });
        const filenames = changedFiles.data.map(file => file.filename);
        core_1.default.info("Found PR files:");
        core_1.default.info(filenames.join(", "));
        return filenames;
    });
}
function selectReviewers(assigned, filesChanged, codeowners) {
    var _a, _b, _c, _d;
    return __awaiter(this, void 0, void 0, function* () {
        const randomize = (input) => input === null || input === void 0 ? void 0 : input.sort((_, __) => Math.random() - 0.5);
        const selectedReviewers = [];
        const randomFiles = randomize(filesChanged);
        const globalCodeOwners = (_a = codeowners.find(owner => owner.pattern === "*")) === null || _a === void 0 ? void 0 : _a.owners;
        const randomGlobalCodeOwners = randomize(globalCodeOwners);
        while (selectedReviewers.length + assigned < reviewers) {
            const randomFile = (_b = randomFiles.shift()) !== null && _b !== void 0 ? _b : "";
            const fileOwner = (_d = randomize((_c = (0, codeowners_utils_1.matchFile)(randomFile, codeowners)) === null || _c === void 0 ? void 0 : _c.owners)) === null || _d === void 0 ? void 0 : _d.shift();
            const randomCodeOwner = randomGlobalCodeOwners === null || randomGlobalCodeOwners === void 0 ? void 0 : randomGlobalCodeOwners.shift();
            const selected = fileOwner !== null && fileOwner !== void 0 ? fileOwner : randomCodeOwner;
            if (selected) {
                selectedReviewers.push(selected);
                assigned++;
            }
        }
        return selectedReviewers;
    });
}
function assignReviewers(pullRequestInformation, reviewers, octokit) {
    return __awaiter(this, void 0, void 0, function* () {
        const { repo, owner, number } = pullRequestInformation;
        const assigned = yield octokit.rest.pulls.requestReviewers({ owner, repo, pull_number: number, reviewers });
        return assigned.data.requested_reviewers;
    });
}
run();

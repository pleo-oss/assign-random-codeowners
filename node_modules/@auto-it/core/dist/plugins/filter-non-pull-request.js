"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const await_to_js_1 = tslib_1.__importDefault(require("await-to-js"));
/** Filter out PR numbers that might generate errors. */
class FilterNonPullRequestPlugin {
    constructor() {
        /** The name of the plugin */
        this.name = "Filter Non Pull Request";
    }
    /** Tap into auto plugin points. */
    apply(auto) {
        auto.hooks.onCreateLogParse.tap(this.name, (logParse) => {
            logParse.hooks.omitCommit.tapPromise(this.name, async (commit) => {
                var _a;
                if ((_a = commit.pullRequest) === null || _a === void 0 ? void 0 : _a.number) {
                    const { number: prNumber } = commit.pullRequest;
                    const [err, info] = await await_to_js_1.default(auto.git.getPr(prNumber));
                    // Omit PRs that don't exist on the repo
                    if (err === null || err === void 0 ? void 0 : err.message.includes("Not Found")) {
                        return true;
                    }
                    if (err) {
                        throw err;
                    }
                    if (!info) {
                        throw new Error(`Could not find PR: ${prNumber}`);
                    }
                    // Omit issues
                    if (!info.data.pull_request) {
                        return true;
                    }
                }
            });
        });
    }
}
exports.default = FilterNonPullRequestPlugin;
//# sourceMappingURL=filter-non-pull-request.js.map
'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var requestError = require('@octokit/request-error');

const VERSION = "1.3.0";

function enterpriseCompatibility(octokit) {
  octokit.hook.wrap("request", async (request, options) => {
    // TODO: implement fix for #62 here
    // https://github.com/octokit/plugin-enterprise-compatibility.js/issues/60
    if (/\/orgs\/[^/]+\/teams/.test(options.url)) {
      try {
        return await request(options);
      } catch (error) {
        if (error.status !== 404) {
          throw error;
        }

        if (!error.response || !error.response.headers["x-github-enterprise-version"]) {
          throw error;
        }

        const deprecatedUrl = options.url.replace(/\/orgs\/[^/]+\/teams\/[^/]+/, "/teams/{team_id}");
        throw new requestError.RequestError(`"${options.method} ${options.url}" is not supported in your GitHub Enterprise Server version. Please replace with octokit.request("${options.method} ${deprecatedUrl}", { team_id })`, 404, {
          request: options
        });
      }
    }

    return request(options);
  });
}
enterpriseCompatibility.VERSION = VERSION;

exports.enterpriseCompatibility = enterpriseCompatibility;
//# sourceMappingURL=index.js.map

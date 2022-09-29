# Assign Random CODEOWNERS Reviewers

A GitHub Action for randomly assigning CODEOWNERS to changes submitted in PRs.

---

# Usage

## Inputs

| Input                       | Type    | Required | Description                                                                                                                                                                               |
| --------------------------- | ------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reviewers-to-assign`       | number  | ✅       | How many _total_ reviewers to assign to a given PR. The action will not assign more reviewers than the number given and takes already assigned reviewers into consideration when running. |
| `assign-from-changed-files` | boolean | ❌       | Whether to assign reviewers from the files changed in a PR. If a CODEOWNER cannot be found for a file, the action will select randomly from the global CODEOWNERS.                        |

The action requires a `GITHUB_TOKEN` to be present in the `env` with the required permissions to assign PR reviewers.

## Outputs

| Input                 | Type                                                  | Description                       |
| --------------------- | ----------------------------------------------------- | --------------------------------- |
| `assigned-codeowners` | `{ count: number, teams: string[], users: string[] }` | The reviewers assigned to the PR. |

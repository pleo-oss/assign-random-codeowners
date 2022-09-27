# Assign Random CODEOWNERS Reviewers

A GitHub Action for randomly assigning CODEOWNERS to changes submitted in PRs.

---

# Usage

## Inputs

| Input                       | Type    | Required     | Description                                                                                                                                                                               |
| --------------------------- | ------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reviewers-to-assign`       | Number  | :white-tick: | How many _total_ reviewers to assign to a given PR. The action will not assign more reviewers than the number given and takes already assigned reviewers into consideration when running. |
| `assign-from-changed-files` | boolean | :x:          | Whether to assign reviewers from the files changes in a PR. If a CODEOWNER cannot be found for a file, the action will select randomly from the global CODEOWNERS.                        |

## Outputs

| Input                 | Type                                                  | Description                       |
| --------------------- | ----------------------------------------------------- | --------------------------------- |
| `assigned-codeowners` | `{ count: number, teams: string[], users: string[] }` | The reviewers assigned to the PR. |
|                       |                                                       |                                   |

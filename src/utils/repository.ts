export type RepositoryCoordinates = {
  owner: string;
  repo: string;
};

export function parseRepositoryCoordinates(
  githubRepository: string,
): RepositoryCoordinates {
  const parts = githubRepository.split("/");

  if (parts.length !== 2 || parts[0] === "" || parts[1] === "") {
    throw new Error(
      `GITHUB_REPOSITORY must be in the form "owner/repo", got: "${githubRepository}".`,
    );
  }

  return { owner: parts[0], repo: parts[1] };
}

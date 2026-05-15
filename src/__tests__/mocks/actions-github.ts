/* eslint-disable @typescript-eslint/naming-convention */
export type ReleaseRequest = {
  owner: string;
  repo: string;
  tag_name: string;
  target_commitish: string;
  name: string;
  body: string;
  draft: boolean;
  prerelease: boolean;
};

export type ReleaseResponse = {
  data: {
    html_url?: string;
  };
};

type CreateReleaseHandler = (input: ReleaseRequest) => Promise<ReleaseResponse>;

const releaseCalls: ReleaseRequest[] = [];
const octokitTokens: string[] = [];

const defaultHandler: CreateReleaseHandler = (
  input: ReleaseRequest,
): Promise<ReleaseResponse> =>
  Promise.resolve({
    data: {
      html_url: `https://github.com/${input.owner}/${input.repo}/releases/tag/${input.tag_name}`,
    },
  });

let createReleaseHandler: CreateReleaseHandler = defaultHandler;

export const context: { repo: { owner: string; repo: string } } = {
  repo: {
    owner: "test-owner",
    repo: "test-repo",
  },
};

export function getOctokit(token: string): {
  rest: {
    repos: {
      createRelease: (input: ReleaseRequest) => Promise<ReleaseResponse>;
    };
  };
} {
  octokitTokens.push(token);

  return {
    rest: {
      repos: {
        createRelease: (input: ReleaseRequest): Promise<ReleaseResponse> => {
          releaseCalls.push(input);
          return createReleaseHandler(input);
        },
      },
    },
  };
}

export function __resetGithubMock(): void {
  releaseCalls.length = 0;
  octokitTokens.length = 0;
  context.repo.owner = "test-owner";
  context.repo.repo = "test-repo";
  createReleaseHandler = defaultHandler;
}

export function __setRepoContext(owner: string, repo: string): void {
  context.repo.owner = owner;
  context.repo.repo = repo;
}

export function __setCreateReleaseHandler(handler: CreateReleaseHandler): void {
  createReleaseHandler = handler;
}

export function __getCreateReleaseCalls(): readonly ReleaseRequest[] {
  return [...releaseCalls];
}

export function __getOctokitTokens(): readonly string[] {
  return [...octokitTokens];
}
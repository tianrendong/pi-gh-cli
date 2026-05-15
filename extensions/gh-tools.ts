import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	truncateHead,
	truncateTail,
} from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";

const COMMON_TIMEOUT_MS = 30_000;
const WATCH_TIMEOUT_MS = 15 * 60_000;
const COMMON_REPO_HELP = "Repository in [HOST/]OWNER/REPO format. Defaults to current gh/git context.";
const JSON_HELP = "Comma-separated gh --json fields. Defaults chosen from gh docs for agent-friendly output.";

const ghIssueActions = ["list", "view", "create", "comment", "edit", "close", "reopen"] as const;
const ghPrActions = [
	"list",
	"view",
	"checks",
	"diff",
	"create",
	"comment",
	"review",
	"merge",
	"close",
	"reopen",
	"ready",
	"checkout",
	"update_branch",
] as const;
const ghRepoActions = ["view", "list", "default", "create", "edit"] as const;
const ghRunActions = ["list", "view", "watch", "rerun", "cancel", "download"] as const;
const ghWorkflowActions = ["list", "view", "run", "enable", "disable"] as const;
const httpMethods = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
const reviewActions = ["approve", "comment", "request_changes"] as const;
const mergeMethods = ["merge", "squash", "rebase"] as const;

const issueDefaultFields = "number,title,state,author,assignees,labels,updatedAt,url";
const issueViewDefaultFields = "number,title,state,author,assignees,labels,body,comments,createdAt,updatedAt,url";
const prDefaultFields = "number,title,state,isDraft,author,baseRefName,headRefName,reviewDecision,mergeable,updatedAt,url";
const prViewDefaultFields = "number,title,state,isDraft,author,baseRefName,headRefName,body,comments,files,commits,reviewDecision,mergeStateStatus,mergeable,statusCheckRollup,updatedAt,url";
const repoDefaultFields = "nameWithOwner,description,visibility,isPrivate,isArchived,defaultBranchRef,primaryLanguage,repositoryTopics,stargazerCount,forkCount,url";
const runDefaultFields = "databaseId,number,name,displayTitle,workflowName,event,status,conclusion,headBranch,headSha,createdAt,updatedAt,url";
const workflowDefaultFields = "id,name,path,state";

const KeyValueParam = Type.Object({
	key: Type.String(),
	value: Type.String(),
});

type KeyValue = Static<typeof KeyValueParam>;

const GhIssueParams = Type.Object({
	action: StringEnum(ghIssueActions),
	repo: Type.Optional(Type.String({ description: COMMON_REPO_HELP })),
	number: Type.Optional(Type.String({ description: "Issue number or URL for view/comment/edit/close/reopen." })),
	state: Type.Optional(StringEnum(["open", "closed", "all"] as const)),
	limit: Type.Optional(Type.Number({ description: "Maximum items to fetch." })),
	search: Type.Optional(Type.String({ description: "gh issue list --search query." })),
	label: Type.Optional(Type.Array(Type.String(), { description: "Labels. Repeated -l/--label." })),
	assignee: Type.Optional(Type.String()),
	author: Type.Optional(Type.String()),
	fields: Type.Optional(Type.String({ description: JSON_HELP })),
	comments: Type.Optional(Type.Boolean({ description: "Include comments for view." })),
	title: Type.Optional(Type.String({ description: "Title for create/edit." })),
	body: Type.Optional(Type.String({ description: "Body/comment text." })),
	addLabel: Type.Optional(Type.Array(Type.String())),
	removeLabel: Type.Optional(Type.Array(Type.String())),
	addAssignee: Type.Optional(Type.Array(Type.String())),
	removeAssignee: Type.Optional(Type.Array(Type.String())),
	closeReason: Type.Optional(StringEnum(["completed", "not planned", "duplicate"] as const)),
	confirm: Type.Optional(Type.Boolean({ description: "Required/checked for GitHub state-changing actions." })),
});

type GhIssueParamsT = Static<typeof GhIssueParams>;

const GhPrParams = Type.Object({
	action: StringEnum(ghPrActions),
	repo: Type.Optional(Type.String({ description: COMMON_REPO_HELP })),
	number: Type.Optional(Type.String({ description: "PR number, URL, or branch." })),
	state: Type.Optional(StringEnum(["open", "closed", "merged", "all"] as const)),
	limit: Type.Optional(Type.Number()),
	search: Type.Optional(Type.String()),
	label: Type.Optional(Type.Array(Type.String())),
	assignee: Type.Optional(Type.String()),
	author: Type.Optional(Type.String()),
	base: Type.Optional(Type.String()),
	head: Type.Optional(Type.String()),
	fields: Type.Optional(Type.String({ description: JSON_HELP })),
	comments: Type.Optional(Type.Boolean({ description: "Include comments for view." })),
	title: Type.Optional(Type.String({ description: "Title for create/edit/revert." })),
	body: Type.Optional(Type.String({ description: "Body/comment/review text." })),
	draft: Type.Optional(Type.Boolean()),
	reviewer: Type.Optional(Type.Array(Type.String())),
	fill: Type.Optional(Type.Boolean({ description: "Use commit info for PR title/body." })),
	review: Type.Optional(StringEnum(reviewActions)),
	mergeMethod: Type.Optional(StringEnum(mergeMethods)),
	auto: Type.Optional(Type.Boolean({ description: "Enable auto-merge." })),
	deleteBranch: Type.Optional(Type.Boolean()),
	admin: Type.Optional(Type.Boolean()),
	matchHeadCommit: Type.Optional(Type.String()),
	nameOnly: Type.Optional(Type.Boolean({ description: "For diff: show changed file names only." })),
	patch: Type.Optional(Type.Boolean({ description: "For diff: show patch." })),
	rebase: Type.Optional(Type.Boolean({ description: "For update_branch: rebase instead of merge update." })),
	branch: Type.Optional(Type.String({ description: "For checkout: local branch name." })),
	force: Type.Optional(Type.Boolean({ description: "For checkout: reset existing local branch." })),
	confirm: Type.Optional(Type.Boolean({ description: "Required/checked for GitHub/local state-changing actions." })),
});

type GhPrParamsT = Static<typeof GhPrParams>;

const GhRepoParams = Type.Object({
	action: StringEnum(ghRepoActions),
	repo: Type.Optional(Type.String({ description: COMMON_REPO_HELP })),
	owner: Type.Optional(Type.String({ description: "Owner for repo list." })),
	limit: Type.Optional(Type.Number()),
	fields: Type.Optional(Type.String({ description: JSON_HELP })),
	branch: Type.Optional(Type.String()),
	visibility: Type.Optional(StringEnum(["public", "private", "internal"] as const)),
	language: Type.Optional(Type.String()),
	topic: Type.Optional(Type.Array(Type.String())),
	name: Type.Optional(Type.String({ description: "Repo name for create." })),
	description: Type.Optional(Type.String()),
	homepage: Type.Optional(Type.String()),
	addReadme: Type.Optional(Type.Boolean()),
	gitignore: Type.Optional(Type.String()),
	license: Type.Optional(Type.String()),
	clone: Type.Optional(Type.Boolean()),
	source: Type.Optional(Type.String()),
	remote: Type.Optional(Type.String()),
	addTopic: Type.Optional(Type.Array(Type.String())),
	removeTopic: Type.Optional(Type.Array(Type.String())),
	defaultBranch: Type.Optional(Type.String()),
	enableIssues: Type.Optional(Type.Boolean()),
	enableWiki: Type.Optional(Type.Boolean()),
	enableProjects: Type.Optional(Type.Boolean()),
	deleteBranchOnMerge: Type.Optional(Type.Boolean()),
	confirm: Type.Optional(Type.Boolean({ description: "Required/checked for GitHub/local state-changing actions." })),
});

type GhRepoParamsT = Static<typeof GhRepoParams>;

const GhRunParams = Type.Object({
	action: StringEnum(ghRunActions),
	repo: Type.Optional(Type.String({ description: COMMON_REPO_HELP })),
	runId: Type.Optional(Type.String({ description: "Workflow run database ID." })),
	limit: Type.Optional(Type.Number()),
	fields: Type.Optional(Type.String({ description: JSON_HELP })),
	branch: Type.Optional(Type.String()),
	commit: Type.Optional(Type.String()),
	workflow: Type.Optional(Type.String()),
	status: Type.Optional(Type.String({ description: "queued|completed|in_progress|failure|success|... per gh run docs." })),
	event: Type.Optional(Type.String()),
	user: Type.Optional(Type.String()),
	log: Type.Optional(Type.Boolean({ description: "For view: include full log." })),
	logFailed: Type.Optional(Type.Boolean({ description: "For view: include failed-step logs." })),
	verbose: Type.Optional(Type.Boolean()),
	job: Type.Optional(Type.String()),
	attempt: Type.Optional(Type.Number()),
	exitStatus: Type.Optional(Type.Boolean()),
	failed: Type.Optional(Type.Boolean({ description: "For rerun: rerun failed jobs only." })),
	debug: Type.Optional(Type.Boolean({ description: "For rerun: enable debug logging." })),
	force: Type.Optional(Type.Boolean({ description: "For cancel: force cancel." })),
	dir: Type.Optional(Type.String({ description: "For download: output directory." })),
	name: Type.Optional(Type.Array(Type.String(), { description: "For download: artifact names." })),
	pattern: Type.Optional(Type.Array(Type.String(), { description: "For download: artifact glob patterns." })),
	interval: Type.Optional(Type.Number({ description: "For watch: seconds between refresh." })),
	confirm: Type.Optional(Type.Boolean({ description: "Required/checked for cancel/rerun/download/watch." })),
});

type GhRunParamsT = Static<typeof GhRunParams>;

const GhWorkflowParams = Type.Object({
	action: StringEnum(ghWorkflowActions),
	repo: Type.Optional(Type.String({ description: COMMON_REPO_HELP })),
	workflow: Type.Optional(Type.String({ description: "Workflow ID, name, or filename." })),
	limit: Type.Optional(Type.Number()),
	fields: Type.Optional(Type.String({ description: JSON_HELP })),
	all: Type.Optional(Type.Boolean({ description: "Include disabled workflows for list." })),
	ref: Type.Optional(Type.String({ description: "Branch/tag ref for workflow run/view." })),
	yaml: Type.Optional(Type.Boolean({ description: "For view: show workflow YAML." })),
	field: Type.Optional(Type.Array(KeyValueParam, { description: "Workflow dispatch inputs, passed as -f key=value." })),
	confirm: Type.Optional(Type.Boolean({ description: "Required/checked for workflow run/enable/disable." })),
});

type GhWorkflowParamsT = Static<typeof GhWorkflowParams>;

const GhApiParams = Type.Object({
	endpoint: Type.String({ description: "REST endpoint or GraphQL endpoint, e.g. repos/OWNER/REPO/issues or graphql." }),
	method: Type.Optional(StringEnum(httpMethods)),
	hostname: Type.Optional(Type.String()),
	field: Type.Optional(Type.Array(KeyValueParam, { description: "Typed gh api -F key=value fields." })),
	rawField: Type.Optional(Type.Array(KeyValueParam, { description: "String gh api -f key=value fields." })),
	header: Type.Optional(Type.Array(KeyValueParam, { description: "Headers, passed as -H key:value." })),
	preview: Type.Optional(Type.Array(Type.String(), { description: "API previews without -preview suffix." })),
	paginate: Type.Optional(Type.Boolean()),
	slurp: Type.Optional(Type.Boolean()),
	jq: Type.Optional(Type.String()),
	cache: Type.Optional(Type.String({ description: "Cache duration, e.g. 60m." })),
	confirm: Type.Optional(Type.Boolean({ description: "Required/checked for non-GET methods." })),
});

type GhApiParamsT = Static<typeof GhApiParams>;

function addRepo(args: string[], repo?: string): void {
	if (repo) args.push("--repo", repo);
}

function addJson(args: string[], fields?: string, fallback?: string): void {
	const selected = fields ?? fallback;
	if (selected) args.push("--json", selected);
}

function addLimit(args: string[], limit?: number): void {
	if (limit !== undefined) args.push("--limit", String(limit));
}

function addRepeated(args: string[], flag: string, values?: string[]): void {
	for (const value of values ?? []) args.push(flag, value);
}

function addKv(args: string[], flag: string, values?: KeyValue[]): void {
	for (const pair of values ?? []) args.push(flag, `${pair.key}=${pair.value}`);
}

function targetText(value: string | undefined): string {
	if (value === undefined || value === "") throw new Error("number/runId/workflow target is required for this action");
	return value;
}

async function requireConfirmation(
	ctx: ExtensionContext,
	params: { confirm?: boolean },
	summary: string,
): Promise<void> {
	if (ctx.hasUI) {
		const ok = await ctx.ui.confirm("Confirm GitHub action", `${summary}\n\nThis changes GitHub or local checkout state.`);
		if (!ok) throw new Error("Cancelled by user");
		return;
	}
	if (params.confirm !== true) {
		throw new Error(`Refusing state-changing gh action without confirm=true: ${summary}`);
	}
}

async function formatResult(
	stdout: string,
	stderr: string,
	args: string[],
	mode: "head" | "tail" = "head",
): Promise<{ content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> }> {
	const raw = stdout.trim() || stderr.trim() || "(no output)";
	let parsed: unknown;
	let text = raw;
	try {
		parsed = JSON.parse(raw);
		text = JSON.stringify(parsed, null, 2);
	} catch {
		parsed = undefined;
	}

	const truncation = (mode === "tail" ? truncateTail : truncateHead)(text, {
		maxLines: DEFAULT_MAX_LINES,
		maxBytes: DEFAULT_MAX_BYTES,
	});

	let resultText = truncation.content;
	const details: Record<string, unknown> = {
		command: ["gh", ...args],
		parsed,
		stderr: stderr.trim() || undefined,
	};

	if (truncation.truncated) {
		const dir = await mkdtemp(join(tmpdir(), "pi-gh-"));
		const fullOutputPath = join(dir, "output.txt");
		await writeFile(fullOutputPath, text, "utf8");
		details.truncation = truncation;
		details.fullOutputPath = fullOutputPath;
		resultText += `\n\n[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines`;
		resultText += ` (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).`;
		resultText += ` Full output saved to: ${fullOutputPath}]`;
	}

	return { content: [{ type: "text", text: resultText }], details };
}

async function execGh(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	args: string[],
	options: { timeout?: number; mode?: "head" | "tail" } = {},
) {
	const result = await pi.exec("gh", args, {
		cwd: ctx.cwd,
		signal: ctx.signal,
		timeout: options.timeout ?? COMMON_TIMEOUT_MS,
	});
	if (result.code !== 0) {
		const message = result.stderr.trim() || result.stdout.trim() || `gh exited ${result.code}`;
		throw new Error(message);
	}
	return formatResult(result.stdout, result.stderr, args, options.mode);
}

async function execGhAllowNonzero(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	args: string[],
	options: { timeout?: number; mode?: "head" | "tail" } = {},
) {
	const result = await pi.exec("gh", args, {
		cwd: ctx.cwd,
		signal: ctx.signal,
		timeout: options.timeout ?? COMMON_TIMEOUT_MS,
	});
	const formatted = await formatResult(result.stdout, result.stderr, args, options.mode);
	formatted.details.exitCode = result.code;
	return formatted;
}

function renderGhCall(name: string, action: string | undefined, target?: string) {
	return (theme: any) => {
		let text = theme.fg("toolTitle", theme.bold(name));
		if (action) text += " " + theme.fg("accent", action);
		if (target !== undefined) text += " " + theme.fg("muted", String(target));
		return new Text(text, 0, 0);
	};
}

function renderGhResult(result: any, { expanded, isPartial }: any, theme: any) {
	if (isPartial) return new Text(theme.fg("warning", "running gh..."), 0, 0);
	const details = result.details as Record<string, unknown> | undefined;
	const command = Array.isArray(details?.command) ? (details.command as string[]).join(" ") : "gh";
	let text = theme.fg("success", command);
	if (details?.truncation) text += theme.fg("warning", " (truncated)");
	if (expanded) {
		const content = result.content?.[0];
		if (content?.type === "text") text += "\n" + theme.fg("dim", content.text.split("\n").slice(0, 30).join("\n"));
		if (details?.fullOutputPath) text += "\n" + theme.fg("muted", `Full output: ${details.fullOutputPath}`);
	}
	return new Text(text, 0, 0);
}

export default function (pi: ExtensionAPI): void {
	pi.registerTool({
		name: "gh_issue",
		label: "GitHub issue",
		description:
			"Structured GitHub issue operations via gh. Supports list/view/create/comment/edit/close/reopen. Uses gh --json where possible. Output truncated to " +
			`${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}. State-changing actions require confirmation.`,
		promptSnippet: "Structured GitHub issue operations via gh (list/view/create/comment/edit/close/reopen).",
		promptGuidelines: [
			"Use gh_issue instead of bash gh issue commands when interacting with GitHub issues.",
			"Only invoke state-changing gh_issue actions when user explicitly requested that GitHub change.",
		],
		parameters: GhIssueParams,
		async execute(_id, params: GhIssueParamsT, _signal, _onUpdate, ctx) {
			const args = ["issue", params.action.replace("_", "-")];
			addRepo(args, params.repo);
			switch (params.action) {
				case "list":
					addLimit(args, params.limit);
					if (params.state) args.push("--state", params.state);
					if (params.search) args.push("--search", params.search);
					if (params.assignee) args.push("--assignee", params.assignee);
					if (params.author) args.push("--author", params.author);
					addRepeated(args, "--label", params.label);
					addJson(args, params.fields, issueDefaultFields);
					break;
				case "view":
					args.push(targetText(params.number));
					if (params.comments) args.push("--comments");
					addJson(args, params.fields, params.comments ? undefined : issueViewDefaultFields);
					break;
				case "create":
					await requireConfirmation(ctx, params, `gh issue create ${params.title ?? ""}`);
					if (!params.title) throw new Error("title is required for issue create");
					args.push("--title", params.title);
					if (params.body) args.push("--body", params.body);
					addRepeated(args, "--label", params.label);
					addRepeated(args, "--assignee", params.addAssignee);
					break;
				case "comment":
					await requireConfirmation(ctx, params, `gh issue comment ${targetText(params.number)}`);
					if (!params.body) throw new Error("body is required for issue comment");
					args.push(targetText(params.number), "--body", params.body);
					break;
				case "edit":
					await requireConfirmation(ctx, params, `gh issue edit ${targetText(params.number)}`);
					args.push(targetText(params.number));
					if (params.title) args.push("--title", params.title);
					if (params.body) args.push("--body", params.body);
					addRepeated(args, "--add-label", params.addLabel);
					addRepeated(args, "--remove-label", params.removeLabel);
					addRepeated(args, "--add-assignee", params.addAssignee);
					addRepeated(args, "--remove-assignee", params.removeAssignee);
					break;
				case "close":
					await requireConfirmation(ctx, params, `gh issue close ${targetText(params.number)}`);
					args.push(targetText(params.number));
					if (params.body) args.push("--comment", params.body);
					if (params.closeReason) args.push("--reason", params.closeReason);
					break;
				case "reopen":
					await requireConfirmation(ctx, params, `gh issue reopen ${targetText(params.number)}`);
					args.push(targetText(params.number));
					if (params.body) args.push("--comment", params.body);
					break;
			}
			return execGh(pi, ctx, args);
		},
		renderCall(args: Partial<GhIssueParamsT>, theme) {
			return renderGhCall("gh_issue", args.action, args.number)(theme);
		},
		renderResult: renderGhResult,
	});

	pi.registerTool({
		name: "gh_pr",
		label: "GitHub PR",
		description:
			"Structured GitHub pull request operations via gh. Supports list/view/checks/diff/create/comment/review/merge/close/reopen/ready/checkout/update_branch. Uses gh --json where possible. State-changing actions require confirmation.",
		promptSnippet: "Structured GitHub PR operations via gh.",
		promptGuidelines: [
			"Use gh_pr instead of bash gh pr commands when interacting with pull requests.",
			"Use gh_pr checks before judging PR CI state.",
			"Only invoke state-changing gh_pr actions when user explicitly requested that GitHub or checkout change.",
		],
		parameters: GhPrParams,
		async execute(_id, params: GhPrParamsT, _signal, _onUpdate, ctx) {
			const sub = params.action.replace("_", "-");
			const args = ["pr", sub];
			addRepo(args, params.repo);
			switch (params.action) {
				case "list":
					addLimit(args, params.limit);
					if (params.state) args.push("--state", params.state);
					if (params.search) args.push("--search", params.search);
					if (params.assignee) args.push("--assignee", params.assignee);
					if (params.author) args.push("--author", params.author);
					if (params.base) args.push("--base", params.base);
					if (params.head) args.push("--head", params.head);
					addRepeated(args, "--label", params.label);
					addJson(args, params.fields, prDefaultFields);
					break;
				case "view":
					if (params.number !== undefined) args.push(String(params.number));
					if (params.comments) args.push("--comments");
					addJson(args, params.fields, params.comments ? undefined : prViewDefaultFields);
					break;
				case "checks":
					if (params.number !== undefined) args.push(String(params.number));
					addJson(args, params.fields, "name,workflow,state,completedAt,link,bucket");
					break;
				case "diff":
					if (params.number !== undefined) args.push(String(params.number));
					if (params.nameOnly) args.push("--name-only");
					if (params.patch) args.push("--patch");
					args.push("--color", "never");
					break;
				case "create":
					await requireConfirmation(ctx, params, `gh pr create ${params.title ?? ""}`);
					if (params.title) args.push("--title", params.title);
					if (params.body) args.push("--body", params.body);
					if (params.base) args.push("--base", params.base);
					if (params.head) args.push("--head", params.head);
					if (params.draft) args.push("--draft");
					if (params.fill) args.push("--fill");
					addRepeated(args, "--label", params.label);
					addRepeated(args, "--reviewer", params.reviewer);
					break;
				case "comment":
					await requireConfirmation(ctx, params, `gh pr comment ${params.number ?? "current"}`);
					if (params.number !== undefined) args.push(String(params.number));
					if (!params.body) throw new Error("body is required for pr comment");
					args.push("--body", params.body);
					break;
				case "review":
					await requireConfirmation(ctx, params, `gh pr review ${params.number ?? "current"}`);
					if (params.number !== undefined) args.push(String(params.number));
					if (params.review === "approve") args.push("--approve");
					else if (params.review === "request_changes") args.push("--request-changes");
					else args.push("--comment");
					if (params.body) args.push("--body", params.body);
					break;
				case "merge":
					await requireConfirmation(ctx, params, `gh pr merge ${params.number ?? "current"}`);
					if (params.number !== undefined) args.push(String(params.number));
					if (params.mergeMethod) args.push(`--${params.mergeMethod}`);
					if (params.auto) args.push("--auto");
					if (params.deleteBranch) args.push("--delete-branch");
					if (params.admin) args.push("--admin");
					if (params.matchHeadCommit) args.push("--match-head-commit", params.matchHeadCommit);
					break;
				case "close":
					await requireConfirmation(ctx, params, `gh pr close ${targetText(params.number)}`);
					args.push(targetText(params.number));
					if (params.body) args.push("--comment", params.body);
					if (params.deleteBranch) args.push("--delete-branch");
					break;
				case "reopen":
					await requireConfirmation(ctx, params, `gh pr reopen ${targetText(params.number)}`);
					args.push(targetText(params.number));
					if (params.body) args.push("--comment", params.body);
					break;
				case "ready":
				case "checkout":
				case "update_branch":
					await requireConfirmation(ctx, params, `gh pr ${sub} ${params.number ?? "current"}`);
					if (params.number !== undefined) args.push(String(params.number));
					if (params.branch && params.action === "checkout") args.push("--branch", params.branch);
					if (params.force && params.action === "checkout") args.push("--force");
					if (params.rebase && params.action === "update_branch") args.push("--rebase");
					break;
			}
			return execGh(pi, ctx, args, { mode: params.action === "diff" ? "tail" : "head" });
		},
		renderCall(args: Partial<GhPrParamsT>, theme) {
			return renderGhCall("gh_pr", args.action, args.number)(theme);
		},
		renderResult: renderGhResult,
	});

	pi.registerTool({
		name: "gh_repo",
		label: "GitHub repo",
		description: "Structured GitHub repository operations via gh. Supports view/list/default/create/edit. State-changing actions require confirmation.",
		promptSnippet: "Structured GitHub repository operations via gh.",
		promptGuidelines: ["Use gh_repo instead of bash gh repo commands for repository metadata and settings."],
		parameters: GhRepoParams,
		async execute(_id, params: GhRepoParamsT, _signal, _onUpdate, ctx) {
			const args = ["repo", params.action === "default" ? "set-default" : params.action];
			switch (params.action) {
				case "view":
					if (params.repo) args.push(params.repo);
					if (params.branch) args.push("--branch", params.branch);
					addJson(args, params.fields, repoDefaultFields);
					break;
				case "list":
					if (params.owner) args.push(params.owner);
					addLimit(args, params.limit);
					if (params.visibility) args.push("--visibility", params.visibility);
					if (params.language) args.push("--language", params.language);
					addRepeated(args, "--topic", params.topic);
					addJson(args, params.fields, repoDefaultFields);
					break;
				case "default":
					if (params.repo) args.push(params.repo);
					else args.push("--view");
					break;
				case "create":
					await requireConfirmation(ctx, params, `gh repo create ${params.name ?? ""}`);
					if (params.name) args.push(params.name);
					if (params.description) args.push("--description", params.description);
					if (params.homepage) args.push("--homepage", params.homepage);
					if (params.visibility) args.push(`--${params.visibility}`);
					if (params.addReadme) args.push("--add-readme");
					if (params.gitignore) args.push("--gitignore", params.gitignore);
					if (params.license) args.push("--license", params.license);
					if (params.clone) args.push("--clone");
					if (params.source) args.push("--source", params.source);
					if (params.remote) args.push("--remote", params.remote);
					break;
				case "edit":
					await requireConfirmation(ctx, params, `gh repo edit ${params.repo ?? "current"}`);
					if (params.repo) args.push(params.repo);
					if (params.description) args.push("--description", params.description);
					if (params.homepage) args.push("--homepage", params.homepage);
					if (params.visibility) args.push("--visibility", params.visibility, "--accept-visibility-change-consequences");
					if (params.defaultBranch) args.push("--default-branch", params.defaultBranch);
					addRepeated(args, "--add-topic", params.addTopic);
					addRepeated(args, "--remove-topic", params.removeTopic);
					if (params.enableIssues === true) args.push("--enable-issues");
					if (params.enableWiki === true) args.push("--enable-wiki");
					if (params.enableProjects === true) args.push("--enable-projects");
					if (params.enableIssues === false || params.enableWiki === false || params.enableProjects === false) {
						throw new Error("gh repo edit supports enabling issues/wiki/projects here; use gh_api for disable operations");
					}
					if (params.deleteBranchOnMerge) args.push("--delete-branch-on-merge");
					break;
			}
			return execGh(pi, ctx, args);
		},
		renderCall(args: Partial<GhRepoParamsT>, theme) {
			return renderGhCall("gh_repo", args.action, args.repo)(theme);
		},
		renderResult: renderGhResult,
	});

	pi.registerTool({
		name: "gh_run",
		label: "GitHub Actions run",
		description: "Structured GitHub Actions run operations via gh. Supports list/view/watch/rerun/cancel/download. Logs are tail-truncated; state-changing/long actions require confirmation.",
		promptSnippet: "Structured GitHub Actions run operations via gh.",
		promptGuidelines: ["Use gh_run for Actions run lists, failed logs, reruns, and cancellation."],
		parameters: GhRunParams,
		async execute(_id, params: GhRunParamsT, _signal, _onUpdate, ctx) {
			const args = ["run", params.action];
			addRepo(args, params.repo);
			switch (params.action) {
				case "list":
					addLimit(args, params.limit);
					if (params.branch) args.push("--branch", params.branch);
					if (params.commit) args.push("--commit", params.commit);
					if (params.workflow) args.push("--workflow", params.workflow);
					if (params.status) args.push("--status", params.status);
					if (params.event) args.push("--event", params.event);
					if (params.user) args.push("--user", params.user);
					addJson(args, params.fields, runDefaultFields);
					break;
				case "view":
					if (params.runId !== undefined) args.push(String(params.runId));
					if (params.job) args.push("--job", params.job);
					if (params.attempt !== undefined) args.push("--attempt", String(params.attempt));
					if (params.log) args.push("--log");
					if (params.logFailed) args.push("--log-failed");
					if (params.verbose) args.push("--verbose");
					if (params.exitStatus) args.push("--exit-status");
					if (!params.log && !params.logFailed) addJson(args, params.fields, "databaseId,number,name,displayTitle,workflowName,event,status,conclusion,jobs,headBranch,headSha,createdAt,updatedAt,url");
					break;
				case "watch":
					await requireConfirmation(ctx, params, `gh run watch ${targetText(params.runId)}`);
					args.push(targetText(params.runId));
					if (params.interval) args.push("--interval", String(params.interval));
					if (params.exitStatus) args.push("--exit-status");
					break;
				case "rerun":
					await requireConfirmation(ctx, params, `gh run rerun ${targetText(params.runId)}`);
					args.push(targetText(params.runId));
					if (params.failed) args.push("--failed");
					if (params.debug) args.push("--debug");
					if (params.job) args.push("--job", params.job);
					break;
				case "cancel":
					await requireConfirmation(ctx, params, `gh run cancel ${targetText(params.runId)}`);
					args.push(targetText(params.runId));
					if (params.force) args.push("--force");
					break;
				case "download":
					await requireConfirmation(ctx, params, `gh run download ${params.runId ?? "latest/current selection"}`);
					if (params.runId !== undefined) args.push(String(params.runId));
					if (params.dir) args.push("--dir", params.dir);
					addRepeated(args, "--name", params.name);
					addRepeated(args, "--pattern", params.pattern);
					break;
			}
			return execGh(pi, ctx, args, {
				timeout: params.action === "watch" ? WATCH_TIMEOUT_MS : COMMON_TIMEOUT_MS,
				mode: params.log || params.logFailed || params.action === "watch" ? "tail" : "head",
			});
		},
		renderCall(args: Partial<GhRunParamsT>, theme) {
			return renderGhCall("gh_run", args.action, args.runId)(theme);
		},
		renderResult: renderGhResult,
	});

	pi.registerTool({
		name: "gh_workflow",
		label: "GitHub workflow",
		description: "Structured GitHub Actions workflow operations via gh. Supports list/view/run/enable/disable. State-changing actions require confirmation.",
		promptSnippet: "Structured GitHub workflow operations via gh.",
		promptGuidelines: ["Use gh_workflow for listing, viewing, dispatching, enabling, and disabling Actions workflows."],
		parameters: GhWorkflowParams,
		async execute(_id, params: GhWorkflowParamsT, _signal, _onUpdate, ctx) {
			const args = ["workflow", params.action];
			addRepo(args, params.repo);
			switch (params.action) {
				case "list":
					addLimit(args, params.limit);
					if (params.all) args.push("--all");
					addJson(args, params.fields, workflowDefaultFields);
					break;
				case "view":
					if (params.workflow) args.push(params.workflow);
					if (params.ref) args.push("--ref", params.ref);
					if (params.yaml) args.push("--yaml");
					break;
				case "run":
					await requireConfirmation(ctx, params, `gh workflow run ${targetText(params.workflow)}`);
					args.push(targetText(params.workflow));
					if (params.ref) args.push("--ref", params.ref);
					addKv(args, "--raw-field", params.field);
					break;
				case "enable":
				case "disable":
					await requireConfirmation(ctx, params, `gh workflow ${params.action} ${targetText(params.workflow)}`);
					args.push(targetText(params.workflow));
					break;
			}
			return execGh(pi, ctx, args, { mode: params.yaml ? "head" : "head" });
		},
		renderCall(args: Partial<GhWorkflowParamsT>, theme) {
			return renderGhCall("gh_workflow", args.action, args.workflow)(theme);
		},
		renderResult: renderGhResult,
	});

	pi.registerTool({
		name: "gh_api",
		label: "GitHub API",
		description:
			"Structured gh api wrapper. Builds argument arrays (no shell quoting), supports method/fields/headers/previews/pagination/jq/cache. Non-GET methods require confirmation.",
		promptSnippet: "Authenticated GitHub REST/GraphQL requests through gh api.",
		promptGuidelines: [
			"Use gh_api for GitHub endpoints not covered by gh_issue, gh_pr, gh_repo, gh_run, or gh_workflow.",
			"Prefer read-only GET requests unless user explicitly requested a GitHub mutation.",
		],
		parameters: GhApiParams,
		async execute(_id, params: GhApiParamsT, _signal, _onUpdate, ctx) {
			const method = params.method ?? "GET";
			if (method !== "GET") await requireConfirmation(ctx, params, `gh api -X ${method} ${params.endpoint}`);
			const args = ["api", params.endpoint, "--method", method];
			if (params.hostname) args.push("--hostname", params.hostname);
			if (params.paginate) args.push("--paginate");
			if (params.slurp) args.push("--slurp");
			if (params.jq) args.push("--jq", params.jq);
			if (params.cache) args.push("--cache", params.cache);
			addKv(args, "--field", params.field);
			addKv(args, "--raw-field", params.rawField);
			for (const header of params.header ?? []) args.push("--header", `${header.key}:${header.value}`);
			addRepeated(args, "--preview", params.preview);
			return execGh(pi, ctx, args);
		},
		renderCall(args: Partial<GhApiParamsT>, theme) {
			return renderGhCall("gh_api", args.method ?? "GET", args.endpoint)(theme);
		},
		renderResult: renderGhResult,
	});

	pi.registerTool({
		name: "gh_auth_status",
		label: "GitHub auth status",
		description: "Read-only gh auth status wrapper. Never shows tokens.",
		promptSnippet: "Check gh authentication status without exposing tokens.",
		parameters: Type.Object({
			hostname: Type.Optional(Type.String()),
			active: Type.Optional(Type.Boolean({ description: "Show active account only." })),
		}),
		async execute(_id, params: { hostname?: string; active?: boolean }, _signal, _onUpdate, ctx) {
			const args = ["auth", "status"];
			if (params.hostname) args.push("--hostname", params.hostname);
			if (params.active) args.push("--active");
			return execGhAllowNonzero(pi, ctx, args);
		},
		renderCall(_args, theme) {
			return renderGhCall("gh_auth_status", undefined)(theme);
		},
		renderResult: renderGhResult,
	});
}

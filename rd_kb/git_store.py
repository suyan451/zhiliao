from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class GitRepoStatus:
    path: str
    root: str
    is_repo: bool
    branch: str
    head: str
    dirty_files: list[str]
    has_user_name: bool
    has_user_email: bool
    error: str

    @property
    def clean(self) -> bool:
        return self.is_repo and not self.dirty_files

    @property
    def publishable(self) -> bool:
        return (
            self.is_repo
            and bool(self.branch)
            and bool(self.head)
            and self.clean
            and self.has_user_name
            and self.has_user_email
        )


def inspect_git_repo(path: Path) -> GitRepoStatus:
    root_result = _git(path, "rev-parse", "--show-toplevel")
    if root_result.returncode != 0:
        return GitRepoStatus(
            path=str(path),
            root="",
            is_repo=False,
            branch="",
            head="",
            dirty_files=[],
            has_user_name=False,
            has_user_email=False,
            error=_clean_error(root_result),
        )

    root = root_result.stdout.strip()
    branch = _git_value(path, "branch", "--show-current")
    head = _git_value(path, "rev-parse", "--verify", "HEAD")
    dirty_files = [
        line.strip()
        for line in _git_value(path, "status", "--porcelain").splitlines()
        if line.strip()
    ]
    user_name = _git_value(path, "config", "--get", "user.name")
    user_email = _git_value(path, "config", "--get", "user.email")
    return GitRepoStatus(
        path=str(path),
        root=root,
        is_repo=True,
        branch=branch,
        head=head,
        dirty_files=dirty_files,
        has_user_name=bool(user_name),
        has_user_email=bool(user_email),
        error="",
    )


def format_git_status(status: GitRepoStatus) -> str:
    if not status.is_repo:
        return f"Git repository: unavailable\nReason: {status.error}"
    lines = [
        "Git repository: available",
        f"Root: {status.root}",
        f"Branch: {status.branch or '(detached)'}",
        f"HEAD: {status.head}",
        f"Working tree: {'clean' if status.clean else 'dirty'}",
        f"User name configured: {'yes' if status.has_user_name else 'no'}",
        f"User email configured: {'yes' if status.has_user_email else 'no'}",
        f"Publishable: {'yes' if status.publishable else 'no'}",
    ]
    if status.dirty_files:
        lines.append("Dirty files:")
        lines.extend(f"- {item}" for item in status.dirty_files)
    return "\n".join(lines)


def _git(path: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "-C", str(path), *args],
        text=True,
        capture_output=True,
        check=False,
    )


def _git_value(path: Path, *args: str) -> str:
    result = _git(path, *args)
    if result.returncode != 0:
        return ""
    return result.stdout.strip()


def _clean_error(result: subprocess.CompletedProcess[str]) -> str:
    return (result.stderr or result.stdout or "unknown git error").strip()

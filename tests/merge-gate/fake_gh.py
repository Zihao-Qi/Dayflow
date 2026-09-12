#!/usr/bin/env python3
"""Hermetic fake gh CLI runner.
Reads mock routes and records all invocations in FAKE_GH_STATE_FILE.
Fails closed with exit code 127 if an unexpected command is executed.
"""
import json
import os
import sys

def main():
    state_path = os.environ.get("FAKE_GH_STATE_FILE")
    if not state_path:
        sys.stderr.write("FAKE_GH_ERROR: FAKE_GH_STATE_FILE environment variable not set\n")
        sys.exit(127)

    args = sys.argv[1:]

    try:
        with open(state_path, "r", encoding="utf-8") as f:
            state = json.load(f)
    except Exception as e:
        sys.stderr.write(f"FAKE_GH_ERROR: Failed to read state file {state_path}: {e}\n")
        sys.exit(127)

    state.setdefault("recorded_calls", []).append(args)

    # Check for merge command
    if len(args) >= 2 and args[0] == "pr" and args[1] == "merge":
        if state.get("fail_merge"):
            exit_code = state.get("merge_exit_code", 1)
            err = state.get("merge_stderr", "Merge failed in gh pr merge\n")
            with open(state_path, "w", encoding="utf-8") as f:
                json.dump(state, f, indent=2)
            sys.stderr.write(err)
            sys.exit(exit_code)
        if state.get("auto_merge", True):
            state["merged"] = True
        with open(state_path, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=2)
        out = state.get("merge_stdout", f"Merged pull request #{args[2] if len(args) > 2 else ''}\n")
        sys.stdout.write(out)
        sys.exit(0)

    # Check for update-branch command
    if "update-branch" in "".join(args):
        if state.get("fail_update"):
            exit_code = state.get("update_exit_code", 1)
            err = state.get("update_stderr", "Update failed\n")
            with open(state_path, "w", encoding="utf-8") as f:
                json.dump(state, f, indent=2)
            sys.stderr.write(err)
            sys.exit(exit_code)
        with open(state_path, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=2)
        sys.stdout.write(json.dumps(state.get("update_response", {"message": "Branch updated"})) + "\n")
        sys.exit(0)

    # Route matching
    matched_route = None
    routes = state.get("routes", [])
    for idx, route in enumerate(routes):
        match_type = route.get("match", "prefix")
        pattern = route.get("pattern", [])

        if match_type == "exact":
            if args == pattern:
                matched_route = route
                break
        elif match_type == "prefix":
            if len(args) >= len(pattern) and args[:len(pattern)] == pattern:
                matched_route = route
                break
        elif match_type == "contains":
            pattern_str = " ".join(pattern)
            args_str = " ".join(args)
            if pattern_str in args_str:
                matched_route = route
                break
        elif match_type == "graphql":
            if len(args) >= 2 and args[0] == "api" and args[1] == "graphql":
                query_match = route.get("query_contains")
                if not query_match or any(query_match in arg for arg in args):
                    matched_route = route
                    break

    if matched_route is None:
        with open(state_path, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=2)
        sys.stderr.write(f"FAKE_GH_ERROR: Unexpected command not matched by any route: {args}\n")
        sys.exit(127)

    response = matched_route.get("response")
    # If this is a pull request fetch, check if merged flag should dynamically update it
    if isinstance(response, dict) and "number" in response and "state" in response:
        if state.get("merged"):
            response = dict(response)
            response["merged"] = True
            response["state"] = "MERGED"
            response["merge_commit_sha"] = state.get("merge_commit_sha", "f00ba41edf745e800a5bc775fff50c18a8c09a84")

    # If route specifies dynamic override from state (e.g. state['current_main_sha'])
    if isinstance(response, dict) and "object" in response and "sha" in response.get("object", {}):
        if "current_main_sha" in state:
            response = {"object": {"sha": state["current_main_sha"]}}

    # If route specifies one-time consumption
    if matched_route.get("once"):
        routes.remove(matched_route)
        state["routes"] = routes

    with open(state_path, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2)

    exit_code = matched_route.get("exit_code", 0)
    stderr = matched_route.get("stderr", "")
    if stderr:
        sys.stderr.write(stderr)

    if exit_code != 0:
        sys.exit(exit_code)

    if isinstance(response, (dict, list)):
        sys.stdout.write(json.dumps(response) + "\n")
    elif response is not None:
        sys.stdout.write(str(response))
    sys.exit(0)

if __name__ == "__main__":
    main()

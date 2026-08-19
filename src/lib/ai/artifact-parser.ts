// MiMo AI — Streaming Artifact Parser
// Parses <mimoArtifact> XML tags from streaming model output in real-time.
// Inspired by bolt.diy's StreamingMessageParser.

import {
  ARTIFACT_TAG_OPEN,
  ARTIFACT_TAG_CLOSE,
  ACTION_TAG_OPEN,
  ACTION_TAG_CLOSE,
} from "./artifact-format";

export interface ArtifactAction {
  id: string;
  type: "file" | "shell" | "start";
  filePath?: string;
  content: string;
  status: "streaming" | "complete";
}

export interface Artifact {
  id: string;
  title: string;
  actions: ArtifactAction[];
  status: "streaming" | "complete";
}

export interface ParsedStream {
  text: string; // non-artifact text (for markdown rendering)
  artifacts: Artifact[];
}

interface ParserState {
  position: number;
  insideArtifact: boolean;
  insideAction: boolean;
  currentArtifact?: Artifact;
  currentAction?: ArtifactAction;
  actionCounter: number;
}

/**
 * Parse streaming content and extract artifacts + actions.
 * Maintains state per message to handle incremental streaming.
 */
export class ArtifactParser {
  private states = new Map<string, ParserState>();

  parse(messageId: string, input: string): ParsedStream {
    let state = this.states.get(messageId);
    if (!state) {
      state = {
        position: 0,
        insideArtifact: false,
        insideAction: false,
        actionCounter: 0,
      };
      this.states.set(messageId, state);
    }

    let text = "";
    let i = state.position;

    while (i < input.length) {
      // Check for artifact open tag
      if (!state.insideArtifact && input.startsWith(ARTIFACT_TAG_OPEN, i)) {
        const closeBracket = input.indexOf(">", i);
        if (closeBracket === -1) {
          // Partial tag — wait for more data
          break;
        }
        // Extract attributes
        const tagContent = input.slice(i, closeBracket);
        const idMatch = /id="([^"]*)"/.exec(tagContent);
        const titleMatch = /title="([^"]*)"/.exec(tagContent);

        state.insideArtifact = true;
        state.currentArtifact = {
          id: idMatch?.[1] ?? `artifact-${Date.now()}`,
          title: titleMatch?.[1] ?? "Project",
          actions: [],
          status: "streaming",
        };
        state.actionCounter = 0;
        i = closeBracket + 1;
        continue;
      }

      // Check for artifact close tag
      if (state.insideArtifact && input.startsWith(ARTIFACT_TAG_CLOSE, i)) {
        if (state.currentAction) {
          state.currentAction.status = "complete";
          state.currentArtifact?.actions.push(state.currentAction);
          state.currentAction = undefined;
        }
        if (state.currentArtifact) {
          state.currentArtifact.status = "complete";
        }
        state.insideArtifact = false;
        state.insideAction = false;
        i += ARTIFACT_TAG_CLOSE.length;
        continue;
      }

      // Check for action open tag (inside artifact)
      if (state.insideArtifact && !state.insideAction && input.startsWith(ACTION_TAG_OPEN, i)) {
        const closeBracket = input.indexOf(">", i);
        if (closeBracket === -1) {
          break; // partial tag
        }
        const tagContent = input.slice(i, closeBracket);
        const typeMatch = /type="([^"]*)"/.exec(tagContent);
        const pathMatch = /filePath="([^"]*)"/.exec(tagContent);

        state.insideAction = true;
        state.actionCounter++;
        state.currentAction = {
          id: `action-${state.actionCounter}`,
          type: (typeMatch?.[1] as ArtifactAction["type"]) ?? "file",
          filePath: pathMatch?.[1],
          content: "",
          status: "streaming",
        };
        i = closeBracket + 1;
        continue;
      }

      // Check for action close tag
      if (state.insideAction && input.startsWith(ACTION_TAG_CLOSE, i)) {
        if (state.currentAction && state.currentArtifact) {
          state.currentAction.status = "complete";
          state.currentArtifact.actions.push(state.currentAction);
        }
        state.insideAction = false;
        state.currentAction = undefined;
        i += ACTION_TAG_CLOSE.length;
        continue;
      }

      // If inside an action, accumulate content
      if (state.insideAction && state.currentAction) {
        // Find the next potential tag
        let nextTag = input.length;
        const actionCloseIdx = input.indexOf(ACTION_TAG_CLOSE, i);
        if (actionCloseIdx !== -1) nextTag = Math.min(nextTag, actionCloseIdx);

        const chunk = input.slice(i, nextTag);
        state.currentAction.content += chunk;
        i = nextTag;
        continue;
      }

      // If inside artifact but not in action, skip whitespace between actions
      if (state.insideArtifact) {
        // Check if we're at a potential tag start
        if (input[i] === "<" && input.startsWith(ACTION_TAG_OPEN, i)) {
          continue; // will be handled in next iteration
        }
        // Skip whitespace
        if (/\s/.test(input[i])) {
          i++;
          continue;
        }
      }

      // Regular text (outside artifact)
      // Find next potential artifact tag
      let nextArtifact = input.indexOf(ARTIFACT_TAG_OPEN, i);
      if (nextArtifact === -1) nextArtifact = input.length;

      text += input.slice(i, nextArtifact);
      i = nextArtifact;
    }

    state.position = i;

    // Build result
    const artifacts: Artifact[] = [];
    if (state.currentArtifact) {
      const artifact = { ...state.currentArtifact };
      if (state.currentAction) {
        artifact.actions = [...artifact.actions, state.currentAction];
      }
      artifacts.push(artifact);
    }

    return { text, artifacts };
  }

  /** Reset state for a message (call when starting a new message) */
  reset(messageId: string) {
    this.states.delete(messageId);
  }

  /** Get final parsed state */
  finalize(messageId: string): ParsedStream {
    const state = this.states.get(messageId);
    if (!state) return { text: "", artifacts: [] };
    if (state.currentArtifact) {
      state.currentArtifact.status = "complete";
      if (state.currentAction) {
        state.currentAction.status = "complete";
        state.currentArtifact.actions.push(state.currentAction);
      }
    }
    const result = this.parse(messageId, "");
    return result;
  }
}

// Singleton instance
export const artifactParser = new ArtifactParser();

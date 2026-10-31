import { createContext, useContext } from "react";
import type { HelpTopicId } from "./helpTopics.js";

export interface HelpApi {
  isOpen: boolean;
  /** Topic to show on open, or null for the start of Help. */
  topic: HelpTopicId | null;
  /**
   * Opens Help, at `topic` when given. Focus goes back to `returnFocus` on
   * close: pass the control that asked, or what had focus before it.
   */
  openHelp: (topic?: HelpTopicId, returnFocus?: HTMLElement | null) => void;
  closeHelp: () => void;
}

export const HelpContext = createContext<HelpApi | null>(null);

/**
 * The Help controller, or null outside a HelpProvider. Components that link to
 * Help render without the link there, so they still render on their own.
 */
export function useHelp(): HelpApi | null {
  return useContext(HelpContext);
}

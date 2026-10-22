"use client";

import { createContext, useContext } from "react";

const CandidateNameContext = createContext<string | undefined>(undefined);

/** The signed-in candidate's own name, from their session, for naming files they download. */
export const CandidateNameProvider = CandidateNameContext.Provider;

export function useCandidateName(): string | undefined {
  return useContext(CandidateNameContext);
}

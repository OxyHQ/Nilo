import { create } from 'zustand';

export interface NewPageDestination {
  workspaceId: string;
  parentId: string | null;
  teamspaceId?: string | null;
}

export const useNewPageStore = create<{
  destination: NewPageDestination | null;
  open: (destination: NewPageDestination) => void;
  close: () => void;
}>((set) => ({
  destination: null,
  open: (destination) => set({ destination }),
  close: () => set({ destination: null }),
}));

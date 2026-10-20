/** Authorized destinations adjacent to one breadcrumb resource. */
export interface NavigationNeighbor {
  kind: 'page' | 'database';
  id: string;
  title: string;
  icon: string | null;
  href: string;
  /** Identifies the resource queried, independently of the client's current route. */
  current: boolean;
}

export interface NavigationNeighbors {
  items: NavigationNeighbor[];
  /** Opaque continuation for this resource and its current location. */
  nextCursor: string | null;
}

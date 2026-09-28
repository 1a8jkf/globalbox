export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, string> = {
    globe:
      "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z",
    explore: "m21 3-6 12-12 6L9 9 21 3ZM9 9l6 6",
    draw: "m15 4 5 5-11 11H4v-5L15 4ZM13 6l5 5M3 4h5M3 4v5",
    home: "m3 11 9-8 9 8M5 9v12h14V9M10 21v-7h4v7",
    market: "M3 9h18l-2-6H5L3 9ZM5 9v12h14V9M9 21v-7h6v7",
    activity: "M3 12h4l3-8 4 16 3-8h4",
    search: "M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0Zm-2 4 7 7",
    plus: "M12 5v14M5 12h14",
    minus: "M5 12h14",
    close: "m6 6 12 12M6 18 18 6",
    layers: "m12 3 10 6-10 6L2 9l10-6ZM2 13l10 6 10-6M2 17l10 6 10-6",
    fullscreen: "M3 9V3h6M15 3h6v6M21 15v6h-6M9 21H3v-6",
    arrow: "M4 12h16m-6-6 6 6-6 6",
    chevron: "m9 5 7 7-7 7",
    people:
      "M16 21v-3c0-5-12-5-12 0v3M14 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM17 4c5 0 5 7 1 7m0 3c4 0 4 4 4 7",
    leaf: "M20 3C6 2 1 11 6 16s15 0 14-13ZM5 20 16 8",
    hammer: "m14 3 7 7-4 4-3-3-9 10-3-3 10-9-3-3 5-3Z",
    mail: "M3 5h18v14H3V5Zm0 1 9 7 9-7",
    logout: "M9 3H3v18h6m6-15 6 6-6 6m-8-6h14",
    coin: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM15 8h-4a2 2 0 0 0 0 4h2a2 2 0 0 1 0 4H9m3-10v12",
    flag: "M5 22V3c6-4 8 4 15 0v10c-7 4-9-4-15 0",
    tree: "m12 2 7 9h-3l5 7H3l5-7H5l7-9Zm0 16v4",
    farm: "M3 19h18M5 16V7m5 9V4m5 12V7m5 9V4M3 8l2 2 2-2m1-3 2 2 2-2m1 3 2 2 2-2m1-3 2 2 2-2",
    road: "m8 2-4 20M16 2l4 20M12 2v4m0 4v4m0 4v4",
    mine: "M3 9c6-8 12-8 18 0M12 5 5 22",
    warehouse: "m2 9 10-6 10 6v12H2V9Zm5 12V11h10v10M7 15h10",
    town: "M3 21h18M5 21V10m7 11V10m7 11V10M2 8l10-6 10 6H2Z",
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths.home} />
    </svg>
  );
}

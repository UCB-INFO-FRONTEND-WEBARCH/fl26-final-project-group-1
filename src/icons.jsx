import React from 'react';

export function Icon({ name, size = 18 }) {
  const paths = {
    seat: <><path d="M7 3v9h11v5H5v-5M7 17v4m10-4v4M18 7v5" /><path d="M7 7h7" /></>,
    controls: <><path d="M4 6h16M4 12h16M4 18h16" /><path d="M8 3v6m8 0v6M10 15v6" /></>,
    teleport: <><path d="m4 6 5-2 6 2 5-2v14l-5 2-6-2-5 2ZM9 4v14m6-12v14" /><circle cx="12" cy="11" r="2" /></>,
    person: <><circle cx="12" cy="6" r="3" /><path d="M6 21v-3a6 6 0 0 1 12 0v3M9 13l3 3 3-3" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>,
    moon: <path d="M20 14.2A8.5 8.5 0 0 1 9.8 4a8.5 8.5 0 1 0 10.4 10.2Z" />,
    reset: (
      <>
        <path d="M3 10a9 9 0 1 1 2.5 8.2" />
        <path d="M3 4v6h6" />
      </>
    ),
    play: <path d="m8 5 11 7-11 7Z" />,
    pause: (
      <>
        <path d="M9 5v14M15 5v14" />
      </>
    ),
    camera: (
      <>
        <rect x="3" y="6" width="18" height="14" rx="3" />
        <path d="m8 6 2-3h4l2 3" />
        <circle cx="12" cy="13" r="3" />
      </>
    ),
    grid: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="3" />
        <path d="M3 9h18M9 3v18M15 3v18M3 15h18" />
      </>
    ),
    robot: (
      <>
        <rect x="4" y="7" width="16" height="13" rx="4" />
        <path d="M12 7V3M9 3h6M1 12v4m22-4v4M8 16h8" />
        <path d="M8 11v1m8-1v1" />
      </>
    ),
    close: <path d="m6 6 12 12M6 18 18 6" />,
    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v6m0-10v1" />
      </>
    ),
    external: (
      <>
        <path d="M14 3h7v7m0-7L10 14" />
        <path d="M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

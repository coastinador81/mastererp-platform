const normalizeHash = (hash) => String(hash || "").replace(/^#\/?/, "");

export const detailHref = (route, key) =>
  `#/${route}/${encodeURIComponent(String(key))}/view`;

export const listHref = (route) => `#/${route}`;

export function detailFromHash(route, hash = window.location.hash) {
  const [currentRoute, key, action] = normalizeHash(hash).split("/");
  return currentRoute === route && action === "view"
    ? decodeURIComponent(key || "")
    : "";
}

export const openDetail = (route, key) => {
  window.location.hash = detailHref(route, key).slice(1);
};

export const closeDetail = (route) => {
  window.location.hash = listHref(route).slice(1);
};

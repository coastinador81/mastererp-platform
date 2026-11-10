import React from "react";
import { detailHref, listHref } from "./detailRoutes.mjs";

export function DetailLink({ route, id, label = "Ver detalle", className = "secondary detail-link" }) {
  return <a className={className} href={detailHref(route, id)}>{label}</a>;
}

export function DetailBackLink({ route, label }) {
  return (
    <a className="quiet detail-back" href={listHref(route)}>
      ← Volver a {label}
    </a>
  );
}

import assert from "node:assert/strict";
import test from "node:test";
import { readableMessage } from "./toastMessage.mjs";

test("traduce errores técnicos conocidos", () => {
  assert.match(readableMessage("invalid_transition"), /estado actual/);
  assert.match(readableMessage("request_failed"), /No se pudo completar/);
});

test("conserva mensajes funcionales ya legibles", () => {
  assert.equal(readableMessage("Dirección obligatoria"), "Dirección obligatoria");
});

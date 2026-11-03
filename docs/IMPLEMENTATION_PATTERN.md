# Patrón verificable de implementación

Este patrón convierte una capacidad priorizada en un candidato migrable. No
autoriza despliegue, aplicación de SQL, backfill ni cutover.

## Puertas obligatorias

1. **Contrato y propietario:** README en cada capa aplicable; dueño funcional y
   del dato, exclusiones, dependencias, permisos, estados y errores explícitos.
2. **Datos:** migración hacia delante, repetible y no destructiva; funciones
   autorizadas; aislamiento tenant/empresa; prueba bajo `mastererp_app` y
   ausencia de DML directo.
3. **Backend:** entrada validada, SQL parametrizado, operación explícita,
   identidad resuelta desde claims verificados y errores sanitizados. Escrituras
   repetibles usan idempotencia o versión optimista según corresponda.
4. **Infraestructura:** `resources.yml` único en la raíz funcional propietaria;
   recursos compartidos referenciados, no duplicados; JWT salvo contrato público
   documentado; permisos Lambda acotados a las rutas declaradas.
5. **Frontend:** interfaz manual disponible aunque exista IA; sesión obtenida en
   runtime mediante `window.mastererpAuth.getAccessToken()`; ningún token o
   secreto en variables Vite. El frontend consume APIs canónicas y no concede
   autorización.
6. **Calidad:** código fuente máximo 500 líneas por archivo, pruebas del área,
   build/paquete local, validadores de estructura, `git diff --check` y README
   con lo ejecutado y lo pendiente.

## Correspondencia mínima

| Capa | Artefactos cuando aplica |
| --- | --- |
| Platform backend | API/repositorio, `lambdas/<nombre>/`, prueba y README |
| Platform frontend | UI manual/standalone, build y README |
| Database | `schema/NNN_*.sql`, manifiesto del migrador, prueba SQL y README |
| Infrastructure | README y un `resources.yml` propietario |
| Documentation | contrato API, estado y evidencia sin confundir candidato con desplegado |

Las rutas funcionales coinciden entre repositorios; las carpetas técnicas
internas no se replican. Repartidores y otros módulos independientes se inyectan
por contrato en lugar de copiar su lógica o sus datos.

## Evidencia y estados

- **Reserva:** carpeta y responsabilidad, sin afirmar implementación.
- **Candidato:** código y contratos completos con pruebas locales.
- **Promovido DEV:** artefactos y SQL aplicados con autorización y smoke remoto.
- **Fuente de verdad:** datos reconciliados, cutover aprobado y rollback probado.

Cada cierre debe indicar el estado exacto. El checkbox de implementación no
equivale a promoción ni permite retirar la fuente anterior.

## Validación de Fase 5

Ejecutar `python scripts/validate_phase5.py` en Platform. Los repositorios de
Database e Infrastructure tienen validadores homónimos para sus responsabilidades.
Los tres complementan, pero no sustituyen, `scripts/validate_structure.py`, las
pruebas funcionales y la revisión humana.

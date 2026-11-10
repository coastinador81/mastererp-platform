# Política de seguridad y divulgación responsable

Versión en vigor desde el {{FECHA_VIGOR}}  
Este texto está en español (la versión en inglés estará disponible próximamente). Si las versiones no coinciden, prevalece la española (Condiciones de uso, apartado 26.8).

La seguridad de nuestros clientes es una prioridad para Uonify. Si encuentras una vulnerabilidad, te pedimos que nos la comuniques de forma responsable, como se explica aquí.

## 1. Cómo protegemos Uonify

- **Cifrado.** Ciframos los datos en tránsito y en reposo, y guardamos cifradas las autorizaciones de los servicios conectados.
- **Accesos.** Aplicamos el principio de mínimo privilegio y separamos los datos de cada cliente.
- **Vigilancia y respuesta.** Vigilamos los sistemas y tenemos un plan de respuesta a incidentes.
- **Detalle técnico.** Las medidas técnicas se describen en el Acuerdo de tratamiento de datos.

## 2. Cómo comunicar una vulnerabilidad

2.1. **Dónde.** Escríbenos a {{EMAIL_SEGURIDAD}}.

2.2. **Qué debes indicar:**
- una descripción de la vulnerabilidad y de su impacto posible;
- los pasos para reproducirla, con pruebas como capturas o peticiones;
- tu nombre o alias y cómo contactarte.

## 3. Qué está incluido

3.1. **Incluido:**
- {{DOMINIO}} y sus subdominios;
- la aplicación web de Uonify y su interfaz de programación;
- el conector local de Uonify.

3.2. **Excluido.** Puedes informarnos de ello, pero no está cubierto por esta política:
- los servicios de terceros (Google, Amazon, Stripe, OpenAI). Comunícaselo a ellos;
- la ingeniería social, el *phishing* y los ataques físicos;
- los ataques de denegación de servicio y las pruebas de carga;
- el *spam* o el envío masivo de formularios;
- los resultados de herramientas automáticas sin una prueba de impacto real;
- la falta de cabeceras o de configuraciones sin un impacto demostrable;
- los fallos que solo afectan a navegadores o sistemas sin soporte.

## 4. Reglas para investigar de buena fe

- **Usa solo tus propias cuentas.** No accedas a datos de otras personas, ni los modifiques ni los borres. Si accedes a ellos por accidente, para, no los guardes y avísanos.
- **No perjudiques el servicio.** No degrades el servicio ni afectes a otros usuarios.
- **Lo justo para demostrarlo.** No explotes la vulnerabilidad más allá de lo necesario para demostrarla.
- **Sin abuso.** No la uses en tu beneficio ni pidas nada a cambio de no divulgarla.
- **Danos tiempo.** No la hagas pública hasta que la hayamos corregido o hayan pasado 90 días desde tu aviso, lo que ocurra antes, salvo que acordemos otra cosa.
- **Cumple la ley.**

## 5. Nuestro compromiso

5.1. Si sigues estas reglas de buena fe:
- consideraremos tu investigación autorizada y no emprenderemos acciones legales contra ti por ella;
- si un tercero inicia acciones contra ti por esa investigación, dejaremos claro que estaba autorizada por esta política.

No podemos comprometer a terceros ni a las autoridades.

5.2. **Cómo responderemos:**
- confirmaremos que hemos recibido tu aviso en un plazo de 3 días hábiles;
- te mantendremos informado mientras lo resolvemos;
- si lo deseas, te mencionaremos cuando se publique la corrección.

5.3. Por ahora no ofrecemos recompensas económicas.

---

## Anexo · Archivo `security.txt`

Va en `https://{{DOMINIO}}/.well-known/security.txt`. La fecha de caducidad se renueva al menos una vez al año.

```
Contact: mailto:{{EMAIL_SEGURIDAD}}
Expires: {{SECURITY_TXT_CADUCIDAD}}
Preferred-Languages: es, en
Canonical: https://{{DOMINIO}}/.well-known/security.txt
Policy: https://{{DOMINIO}}/seguridad
```

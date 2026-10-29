import os

import psycopg

from server import connect


def main() -> None:
    sql_path = os.path.join(os.path.dirname(__file__), "sql", "002_operacion.sql")
    script = open(sql_path, encoding="utf-8").read()
    with connect() as conn:
        conn.execute(script)
        conn.commit()
    print("esquema aplicado")


if __name__ == "__main__":
    main()

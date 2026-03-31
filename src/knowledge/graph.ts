import neo4j, { type Driver, type Record as Neo4jRecord } from "neo4j-driver";

let driver: Driver | null = null;

/**
 * Returns a Neo4j driver singleton, lazily initialized from environment variables.
 */
export function getDriver(): Driver {
  if (!driver) {
    const uri = process.env.NEO4J_URI ?? "bolt://localhost:7687";
    const user = process.env.NEO4J_USER ?? "neo4j";
    const password = process.env.NEO4J_PASSWORD ?? "neo4j";

    driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  }
  return driver;
}

/**
 * Runs a read query against Neo4j and returns the result records.
 */
export async function runQuery(
  cypher: string,
  params?: Record<string, unknown>,
): Promise<Neo4jRecord[]> {
  const session = getDriver().session({ defaultAccessMode: neo4j.session.READ });
  try {
    const result = await session.run(cypher, params ?? {});
    return result.records;
  } finally {
    await session.close();
  }
}

/**
 * Runs a write query against Neo4j and returns the result records.
 */
export async function runWrite(
  cypher: string,
  params?: Record<string, unknown>,
): Promise<Neo4jRecord[]> {
  const session = getDriver().session({ defaultAccessMode: neo4j.session.WRITE });
  try {
    const result = await session.run(cypher, params ?? {});
    return result.records;
  } finally {
    await session.close();
  }
}

/**
 * Closes the Neo4j driver and releases all resources.
 */
export async function closeDriver(): Promise<void> {
  if (driver) {
    await driver.close();
    driver = null;
  }
}

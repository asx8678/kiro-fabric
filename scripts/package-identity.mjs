export const uniquePackageRecords = (records) => {
  const unique = new Map();
  for (const record of records) unique.set(`${record.name}\0${record.version}`, record);
  return [...unique.values()].sort((left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version));
};

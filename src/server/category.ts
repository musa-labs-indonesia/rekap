export function categoryKey(name: string): string {
  return name.trim().normalize("NFKC").toLocaleLowerCase("id-ID");
}

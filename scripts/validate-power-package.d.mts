export interface SkillTreeValidation {
  entries: Array<{ name: string }>;
  skills: string[];
  packageRoot: string;
}

export function validateSkillTree(skills: string, packageRoot?: string): SkillTreeValidation;
export function validatePowerPackage(root: string): {
  ok: true;
  root: string;
  version: string;
  skills: number;
};

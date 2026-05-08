export interface User {
  id: string;
  email: string;
  displayName: string;
  status: 'ACTIVE' | 'INACTIVE' | string;
  defaultProjectId?: string | null;
  defaultScenarioTemplateVersionId?: string | null;
}

export interface AuthToken {
  accessToken: string;
  tokenType: 'Bearer' | string;
  expiresIn: number;
  user: User;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface SignupRequest {
  email: string;
  password: string;
  displayName: string;
}

export type DepartmentStatus = 'active' | 'inactive';

export interface DepartmentRow {
    id: string;
    title: string;
    description: string;
    status: DepartmentStatus;
}

export interface DepartmentPayload {
    title: string;
    description: string;
    status: DepartmentStatus;
}

export interface DepartmentCreateResult {
    id: string;
    title: string;
    description: string;
    status: DepartmentStatus;
}

export interface DepartmentUpdatePayload {
    title?: string;
    description?: string;
    status?: DepartmentStatus;
}

export type DepartmentUpdateResult = DepartmentRow;

export type DepartmentDeleteResult = DepartmentRow;
import { PartialType, PickType } from '@nestjs/swagger';
import { CreatePermissionDto } from './create-permission.dto';

/**
 * Only description is safe to change after creation — permissionCode/
 * resource/action/isSystem are the permission's identity. Allowing a rename
 * would let a caller free up a sensitive code and reassign it to a
 * different permission, bypassing RolePermissionsService's grant-ceiling
 * check (which operates on stable permission ids, not codes).
 */
export class UpdatePermissionDto extends PartialType(PickType(CreatePermissionDto, ['description'] as const)) {}

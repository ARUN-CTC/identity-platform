import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions, ResponseMessage, SkipTenantStatusCheck } from '../../../common';
import { CreateUserDto } from '../dto/create-user.dto';
import { UpdateUserDto } from '../dto/update-user.dto';
import { UserQueryDto } from '../dto/user-query.dto';
import { UsersService } from '../services/users.service';

@ApiTags('users')
@SkipTenantStatusCheck()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @RequirePermissions('USER_MANAGE')
  @ApiOperation({ summary: 'Create a new user (invitation-only)' })
  @ResponseMessage('User created successfully')
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  @Get()
  @RequirePermissions('USER_VIEW')
  @ApiOperation({ summary: 'List users with filters and pagination' })
  list(@Query() query: UserQueryDto) {
    return this.usersService.list(query);
  }

  @Get(':id')
  @RequirePermissions('USER_VIEW')
  @ApiOperation({ summary: 'Get user by identifier' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions('USER_MANAGE')
  @ApiOperation({ summary: 'Update user profile' })
  @ResponseMessage('User updated successfully')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.update(id, dto);
  }

  @Post(':id/activate')
  @RequirePermissions('USER_MANAGE')
  @ApiOperation({ summary: 'Activate a user (from PROVISIONED or SUSPENDED)' })
  @ResponseMessage('User activated successfully')
  activate(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.activate(id);
  }

  @Post(':id/suspend')
  @RequirePermissions('USER_MANAGE')
  @ApiOperation({ summary: 'Suspend an active user' })
  @ResponseMessage('User suspended successfully')
  suspend(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.suspend(id);
  }

  @Post(':id/deactivate')
  @RequirePermissions('USER_MANAGE')
  @ApiOperation({ summary: 'Permanently deactivate a user' })
  @ResponseMessage('User deactivated successfully')
  deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.deactivate(id);
  }

  @Post(':id/resend-invitation')
  @RequirePermissions('USER_MANAGE')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Resend an account-setup invitation email',
    description:
      'Only valid for a PROVISIONED user who has not yet set a password. Invalidates any earlier unused invitation link.',
  })
  @ResponseMessage('Invitation resent')
  async resendInvitation(@Param('id', ParseUUIDPipe) id: string) {
    await this.usersService.resendInvitation(id);
    return null;
  }

  @Delete(':id')
  @RequirePermissions('USER_MANAGE')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft delete user' })
  @ResponseMessage('User deleted successfully')
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.usersService.remove(id);
    return null;
  }
}

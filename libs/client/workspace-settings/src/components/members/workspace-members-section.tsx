import {createInvitationBodySchema} from '@shipfox/api-workspaces-dto';
import {useAuthState} from '@shipfox/client-auth';
import {QueryLoadError} from '@shipfox/client-ui';
import {Badge} from '@shipfox/react-ui/badge';
import {Button} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
import {EmptyState} from '@shipfox/react-ui/empty-state';
import {FormField, FormFieldInput, fieldError} from '@shipfox/react-ui/form-field';
import {Icon} from '@shipfox/react-ui/icon';
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ModalTrigger,
} from '@shipfox/react-ui/modal';
import {Skeleton} from '@shipfox/react-ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@shipfox/react-ui/table';
import {toast} from '@shipfox/react-ui/toast';
import {Code, Header, Text} from '@shipfox/react-ui/typography';
import {formatDate} from '@shipfox/react-ui/utils';
import {useForm} from '@tanstack/react-form';
import {useState} from 'react';
import {
  getInvitationExpiry,
  getMemberRemovalRestriction,
  memberCount,
  type PendingInvitation,
  type WorkspaceMember,
} from '#core/membership.js';
import {useCreateInvitation} from '#hooks/api/create-invitation.js';
import {useListInvitations} from '#hooks/api/list-invitations.js';
import {useListMembers} from '#hooks/api/list-members.js';
import {useRemoveMember} from '#hooks/api/remove-member.js';
import {useRevokeInvitation} from '#hooks/api/revoke-invitation.js';
import {invitationErrorToFormError, memberRemovalErrorMessage} from './form-errors.js';

export function WorkspaceMembersSettingsSection({
  workspaceId,
  workspaceName,
}: {
  workspaceId: string;
  workspaceName: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-32">
      <MembersSection workspaceId={workspaceId} workspaceName={workspaceName} />
      <PendingInvitationsSection workspaceId={workspaceId} workspaceName={workspaceName} />
    </div>
  );
}

function MembersSection({
  workspaceId,
  workspaceName,
}: {
  workspaceId: string;
  workspaceName: string;
}) {
  const auth = useAuthState();
  const query = useListMembers(workspaceId);
  const members = query.data ?? [];

  return (
    <section className="flex flex-col gap-16">
      <div className="flex flex-col gap-4">
        <Header variant="h3">Members</Header>
        <Text size="sm" className="text-foreground-neutral-muted">
          {query.isPending
            ? 'Loading members…'
            : `${memberCount(members)} ${memberCount(members) === 1 ? 'member' : 'members'}`}
        </Text>
      </div>

      {query.isPending ? <TableSkeleton rows={3} cols={3} /> : null}

      {query.isError && query.data === undefined ? (
        <QueryLoadError query={query} subject="members" />
      ) : null}

      {members.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead className="w-80 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((member) => (
              <MemberRow
                key={member.id}
                member={member}
                members={members}
                currentUserId={auth.user?.id}
                workspaceId={workspaceId}
                workspaceName={workspaceName}
              />
            ))}
          </TableBody>
        </Table>
      ) : null}
    </section>
  );
}

function MemberRow({
  member,
  members,
  currentUserId,
  workspaceId,
  workspaceName,
}: {
  member: WorkspaceMember;
  members: readonly WorkspaceMember[];
  currentUserId: string | undefined;
  workspaceId: string;
  workspaceName: string;
}) {
  const [open, setOpen] = useState(false);
  const remove = useRemoveMember(workspaceId);
  const restriction = getMemberRemovalRestriction({member, members, currentUserId});

  async function handleRemove() {
    try {
      await remove.mutateAsync({userId: member.userId});
      toast.success(`Removed ${member.email} from ${workspaceName}.`);
      setOpen(false);
    } catch (error) {
      toast.error(memberRemovalErrorMessage(error));
    }
  }

  return (
    <TableRow className={remove.isPending ? 'opacity-60' : undefined}>
      <TableCell className="font-medium">{member.name ?? 'N/A'}</TableCell>
      <TableCell>
        <Code variant="paragraph">{member.email}</Code>
      </TableCell>
      <TableCell>{formatDate(member.joinedAt)}</TableCell>
      <TableCell className="text-right">
        <Modal open={open} onOpenChange={setOpen}>
          <ModalTrigger asChild>
            <Button
              size="sm"
              variant="transparentMuted"
              aria-label="Remove member"
              disabled={restriction !== undefined}
              isLoading={remove.isPending}
              className={
                remove.isPending
                  ? 'opacity-100 transition-opacity'
                  : 'opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100'
              }
            >
              <Icon name="userUnfollowLine" className="size-16" />
            </Button>
          </ModalTrigger>
          <ModalContent>
            <ModalTitle className="sr-only">Remove member</ModalTitle>
            <ModalHeader>
              <Text size="lg">
                Remove {member.name ?? member.email} from {workspaceName}?
              </Text>
            </ModalHeader>
            <ModalBody>
              <Text size="sm">
                They will lose access immediately. They can be re-invited later.
              </Text>
            </ModalBody>
            <ModalFooter>
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={handleRemove} isLoading={remove.isPending}>
                Remove
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      </TableCell>
    </TableRow>
  );
}

function PendingInvitationsSection({
  workspaceId,
  workspaceName,
}: {
  workspaceId: string;
  workspaceName: string;
}) {
  const query = useListInvitations(workspaceId);
  const invitations = query.data ?? [];
  const [inviteOpen, setInviteOpen] = useState(false);

  return (
    <section className="flex flex-col gap-16">
      <div className="flex items-center justify-between gap-16">
        <div className="flex flex-col gap-4">
          <Header variant="h3">Pending invitations</Header>
          <Text size="sm" className="text-foreground-neutral-muted">
            {query.isPending
              ? 'Loading invitations…'
              : `${invitations.length} ${invitations.length === 1 ? 'invitation' : 'invitations'}`}
          </Text>
        </div>
        <InviteMemberModal
          open={inviteOpen}
          onOpenChange={setInviteOpen}
          workspaceId={workspaceId}
          workspaceName={workspaceName}
        />
      </div>

      {query.isPending ? <TableSkeleton rows={2} cols={3} /> : null}

      {query.isError && query.data === undefined ? (
        <QueryLoadError query={query} subject="invitations" />
      ) : null}

      {query.data !== undefined && invitations.length === 0 ? <EmptyInvitations /> : null}

      {invitations.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Invited by</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead className="w-80 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invitations.map((invitation) => (
              <InvitationRow
                key={invitation.id}
                invitation={invitation}
                workspaceId={workspaceId}
              />
            ))}
          </TableBody>
        </Table>
      ) : null}
    </section>
  );
}

function InvitationRow({
  invitation,
  workspaceId,
}: {
  invitation: PendingInvitation;
  workspaceId: string;
}) {
  const [open, setOpen] = useState(false);
  const revoke = useRevokeInvitation(workspaceId);
  const expiry = getInvitationExpiry(invitation);

  async function handleRevoke() {
    try {
      await revoke.mutateAsync({invitationId: invitation.id});
      toast.success(`Invitation to ${invitation.email} revoked.`);
      setOpen(false);
    } catch {
      toast.error('Could not revoke invitation.');
    }
  }

  return (
    <TableRow className={revoke.isPending ? 'opacity-60' : undefined}>
      <TableCell>
        <Code variant="paragraph">{invitation.email}</Code>
      </TableCell>
      <TableCell>{invitation.invitedByDisplay ?? 'N/A'}</TableCell>
      <TableCell>
        <div className="flex items-center gap-8">
          <Text size="sm">{formatDate(invitation.expiresAt)}</Text>
          {expiry === 'expires-soon' ? <Badge variant="warning">Soon</Badge> : null}
          {expiry === 'expired' ? <Badge variant="error">Expired</Badge> : null}
        </div>
      </TableCell>
      <TableCell className="text-right">
        <Modal open={open} onOpenChange={setOpen}>
          <ModalTrigger asChild>
            <Button
              size="sm"
              variant="transparentMuted"
              aria-label="Revoke invitation"
              isLoading={revoke.isPending}
              className={
                revoke.isPending
                  ? 'opacity-100 transition-opacity'
                  : 'opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100'
              }
            >
              <Icon name="closeLine" className="size-16" />
            </Button>
          </ModalTrigger>
          <ModalContent>
            <ModalTitle className="sr-only">Revoke invitation</ModalTitle>
            <ModalHeader>
              <Text size="lg">Revoke invitation to {invitation.email}?</Text>
            </ModalHeader>
            <ModalBody>
              <Text size="sm">They will no longer be able to use the link from their email.</Text>
            </ModalBody>
            <ModalFooter>
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={handleRevoke} isLoading={revoke.isPending}>
                Revoke
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      </TableCell>
    </TableRow>
  );
}

function InviteMemberModal({
  open,
  onOpenChange,
  workspaceId,
  workspaceName,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  workspaceId: string;
  workspaceName: string;
}) {
  const create = useCreateInvitation(workspaceId);
  const [formError, setFormError] = useState<string | undefined>();

  const form = useForm({
    defaultValues: {email: ''},
    onSubmit: async ({value}) => {
      setFormError(undefined);
      try {
        const result = await create.mutateAsync({email: value.email});
        toast.success(`Invitation sent to ${result.email}.`);
        // Go through handleOpenChange so form.reset() fires and reopening the
        // modal does not show stale form state.
        handleOpenChange(false);
      } catch (error) {
        const mapped = invitationErrorToFormError(error);
        if (mapped.kind === 'field') {
          form.setFieldMeta(mapped.field, (prev) => ({
            ...prev,
            errorMap: {...prev.errorMap, onServer: mapped.message},
          }));
        } else {
          setFormError(mapped.message);
        }
      }
    },
  });

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      form.reset();
      setFormError(undefined);
      create.reset();
    }
    onOpenChange(nextOpen);
  }

  return (
    <Modal open={open} onOpenChange={handleOpenChange}>
      <ModalTrigger asChild>
        <Button size="sm" variant="secondary">
          Invite member
        </Button>
      </ModalTrigger>
      <ModalContent>
        <ModalTitle className="sr-only">Invite a member</ModalTitle>
        <ModalHeader>
          <Text size="lg">Invite a member</Text>
        </ModalHeader>
        <ModalBody className="gap-16">
          {formError ? (
            <Callout role="alert" type="error">
              {formError}
            </Callout>
          ) : null}
          <form
            id="invite-member-form"
            className="flex flex-col gap-16"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void form.handleSubmit();
            }}
          >
            <form.Field
              name="email"
              validators={{
                onBlur: createInvitationBodySchema.shape.email,
                onSubmit: createInvitationBodySchema.shape.email,
              }}
            >
              {(field) => (
                <FormField
                  label="Email"
                  id="invite-email"
                  error={fieldError(field)}
                  description={`They'll receive an email with a link to join ${workspaceName}.`}
                >
                  <FormFieldInput
                    autoComplete="email"
                    autoFocus
                    name="email"
                    type="email"
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    onBlur={field.handleBlur}
                  />
                </FormField>
              )}
            </form.Field>
          </form>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="invite-member-form" isLoading={create.isPending}>
            Send invitation
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function EmptyInvitations() {
  return (
    <EmptyState
      icon="mailLine"
      title="No pending invitations."
      description="Invite someone above to grow your workspace."
    />
  );
}

function TableSkeleton({rows, cols}: {rows: number; cols: number}) {
  return (
    <div className="flex flex-col gap-12">
      {Array.from({length: rows}).map((_, rowIdx) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: stable placeholder rows
        <div key={rowIdx} className="grid grid-cols-3 gap-16">
          {Array.from({length: cols}).map((__, colIdx) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: stable placeholder cells
            <Skeleton key={colIdx} className="h-20" />
          ))}
        </div>
      ))}
    </div>
  );
}

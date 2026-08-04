import {Button} from '@shipfox/react-ui/button';
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@shipfox/react-ui/modal';
import {Text} from '@shipfox/react-ui/typography';

interface IntegrationDeleteConfirmModalProps {
  connectionName: string | undefined;
  open: boolean;
  isPending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function IntegrationDeleteConfirmModal({
  connectionName,
  open,
  isPending,
  onOpenChange,
  onConfirm,
}: IntegrationDeleteConfirmModalProps) {
  const name = connectionName ?? 'this integration';
  return (
    <Modal
      open={open}
      onOpenChange={(nextOpen) => {
        if (isPending && !nextOpen) return;
        onOpenChange(nextOpen);
      }}
    >
      <ModalContent aria-describedby={undefined}>
        <ModalTitle className="sr-only">Delete integration</ModalTitle>
        <ModalHeader title="Delete integration" showClose={!isPending} />
        <ModalBody className="gap-group">
          <Text size="sm">
            Are you sure you want to delete <strong className="font-medium">{name}</strong>? Once
            deleted, Shipfox will immediately stop processing events from this integration. This
            cannot be undone.
          </Text>
        </ModalBody>
        <ModalFooter>
          <Button
            type="button"
            variant="secondary"
            disabled={isPending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" variant="danger" isLoading={isPending} onClick={onConfirm}>
            Delete integration
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

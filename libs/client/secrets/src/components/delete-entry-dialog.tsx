import {Button} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@shipfox/react-ui/modal';
import {Text} from '@shipfox/react-ui/typography';

export function DeleteEntryDialog({
  open,
  onOpenChange,
  entryKey,
  isLoading,
  errorMessage,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  entryKey: string;
  isLoading: boolean;
  errorMessage?: string | undefined;
  onConfirm: () => void;
}) {
  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>
            Delete <strong>{entryKey}</strong>?
          </ModalTitle>
        </ModalHeader>
        <ModalBody className="gap-group">
          <Text size="sm">
            Workflows that reference <strong>{entryKey}</strong> will fail at their next run.
          </Text>
          {errorMessage ? (
            <Callout role="alert" type="error">
              <Text size="sm">{errorMessage}</Text>
            </Callout>
          ) : null}
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="danger" isLoading={isLoading} onClick={onConfirm}>
            Delete
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

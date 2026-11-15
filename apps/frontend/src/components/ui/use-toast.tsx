// Simplified toast component
export const useToast = () => {
  return {
    toast: ({
      title,
      description,
    }: {
      title: string;
      description?: string;
    }) => {
      console.log(`Toast: ${title} - ${description || ''}`);
      // In a real implementation, this would show a toast notification
    },
  };
};

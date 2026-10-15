import { Input } from 'antd';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function SearchInput({ value, onChange, placeholder = 'Search' }: SearchInputProps) {
  return (
    <Input.Search
      allowClear
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className="max-w-xs"
    />
  );
}

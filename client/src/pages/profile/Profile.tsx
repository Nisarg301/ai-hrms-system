import {
    Alert,
    Avatar,
    Button,
    Card,
    Form,
    Input,
    Typography,
    Upload,
    message,
} from 'antd';
import {
    CameraOutlined,
    SaveOutlined,
} from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import { useAppDispatch, useAppSelector } from '../../hooks/store';
import { avatarColors, initialOf } from '../../components/PersonAvatar/PersonAvatar';
import { useTheme } from '../../hooks/useTheme';
import { selectAuthUser } from '../../store/auth/authSelectors';
import { updateProfile } from '../../store/auth/authThunks';
import {
    UpdateProfileFormValues,
    updateProfileSchema,
} from '../../validation/auth.schemas';
import { ApiError } from '../../types/api';
import { applyServerFieldErrors } from '../../utils/applyServerFieldErrors';
import type { AuthUser } from '../../types/auth';

const { Text, Title } = Typography;

export default function ProfilePage() {
    const user = useAppSelector(selectAuthUser);
    const dispatch = useAppDispatch();
    const { tokens, isDarkMode } = useTheme();

    const [serverError, setServerError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);

    // The same letter and colours as the user's avatar everywhere else (PersonAvatar).
    const initial = user?.name ? initialOf(user.name) : '?';

    const EMPTY: UpdateProfileFormValues = {
        name: user?.name || '',
        avatar: undefined,
    };

    const {
        control,
        handleSubmit,
        setError,
        formState,
        reset,
    } = useForm<UpdateProfileFormValues>({
        resolver: zodResolver(updateProfileSchema),
        defaultValues: EMPTY,
    });

    useEffect(() => {
        if (user?.name) {
            reset({
                name: user.name,
                avatar: undefined,
            });
        }
    }, [user?.name, reset]);

    useEffect(() => {
        return () => {
            if (previewUrl) {
                URL.revokeObjectURL(previewUrl);
            }
        };
    }, [previewUrl]);

    const onSubmit = handleSubmit(async (values) => {
        setSubmitting(true);
        setServerError(null);

        try {
            const formData = new FormData();

            formData.append('name', values.name);

            if (values.avatar) {
                formData.append('avatar', values.avatar);
            }

            const result = await dispatch(
                updateProfile({ formData })
            );

            if (updateProfile.rejected.match(result)) {
                const payload = result.payload;

                const reconstructed = payload
                    ? new ApiError(
                        payload.status,
                        payload.message,
                        payload.details
                    )
                    : new ApiError(
                        0,
                        'Could not update your profile'
                    );

                const setFormFieldError = setError as (
                    field: string,
                    error: {
                        type: string;
                        message: string;
                    }
                ) => void;

                const placed = applyServerFieldErrors(
                    reconstructed,
                    setFormFieldError,
                    ['name']
                );

                if (!placed) {
                    setServerError(reconstructed.message);
                }

                return;
            }

            message.success('Profile updated successfully');
            if (previewUrl) {
                URL.revokeObjectURL(previewUrl);
                setPreviewUrl(null);
            }
            if (result.payload) {
                reset({
                    name: (result.payload as AuthUser).name,
                    avatar: undefined,
                });
            }
        } finally {
            setSubmitting(false);
        }
    });

    const displayAvatarUrl = previewUrl || user?.avatar?.url;

    return (
        <div className="mx-auto w-full max-w-5xl">
            {/* Page Header */}
            <div className="mb-6">
                <Title
                    level={3}
                    className="!mb-1"
                    style={{ color: tokens.colorPrimaryDeep }}
                >
                    Profile
                </Title>

                <Text type="secondary">
                    Manage your personal information and profile picture.
                </Text>
            </div>

            {serverError && (
                <Alert
                    className="mb-6"
                    type="error"
                    message={serverError}
                    showIcon
                />
            )}

            {/* Profile Header */}
            <Card
                className="mb-6"
                styles={{
                    body: {
                        padding: 24,
                    },
                }}
            >
                <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                    {/* Avatar + User information */}
                    <div className="flex min-w-0 flex-1 items-center gap-5">
                        <Avatar
                            size={88}
                            src={displayAvatarUrl}
                            style={{
                                ...avatarColors(tokens, isDarkMode),
                                flexShrink: 0,
                            }}
                        >
                            {!displayAvatarUrl && initial}
                        </Avatar>

                        <div className="min-w-0">
                            <Title level={4} className="!mb-1">
                                {user?.name || 'User'}
                            </Title>

                            <Text type="secondary" className="block">
                                {user?.email}
                            </Text>

                            {user?.role && (
                                <div className="mt-2">
                                    <span
                                        className="inline-flex rounded-full border px-3 py-1 text-xs font-medium"
                                        style={{
                                            background: tokens.colorBgLayout,
                                            borderColor: tokens.colorBorder,
                                            color: tokens.colorPrimary,
                                        }}
                                    >
                                        {user.role}
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Change Picture */}
                    <Controller
                        name="avatar"
                        control={control}
                        render={({ field }) => {
                            const fileList = field.value
                                ? [
                                    {
                                        uid: '-1',
                                        name: field.value.name,
                                        status: 'done' as const,
                                    },
                                ]
                                : [];

                            return (
                                <Upload
                                    beforeUpload={(file) => {
                                        field.onChange(file);
                                        if (previewUrl) {
                                            URL.revokeObjectURL(previewUrl);
                                        }
                                        setPreviewUrl(URL.createObjectURL(file));
                                        return false;
                                    }}
                                    fileList={fileList}
                                    onRemove={() => {
                                        field.onChange(undefined);
                                        if (previewUrl) {
                                            URL.revokeObjectURL(previewUrl);
                                            setPreviewUrl(null);
                                        }
                                    }}
                                    maxCount={1}
                                    accept="image/png,image/jpeg,image/jpg"
                                    showUploadList={false}
                                >
                                    <Button icon={<CameraOutlined />}>
                                        Change picture
                                    </Button>
                                </Upload>
                            );
                        }}
                    />
                </div>

                {/* Validation error */}
                {formState.errors.avatar && (
                    <div className="mt-3">
                        <Text type="danger">
                            {formState.errors.avatar.message}
                        </Text>
                    </div>
                )}
            </Card>

            {/* Form */}
            <Form
                layout="vertical"
                onFinish={onSubmit}
            >
                <Card
                    title="Personal Information"
                    className="mb-6"
                    styles={{
                        header: {
                            fontSize: 16,
                            fontWeight: 600,
                        },
                        body: {
                            padding: 24,
                        },
                    }}
                >
                    <div className="grid grid-cols-1 gap-x-6 md:grid-cols-2">
                        <Controller
                            name="name"
                            control={control}
                            render={({ field }) => (
                                <Form.Item
                                    label="Full name"
                                    validateStatus={
                                        formState.errors.name
                                            ? 'error'
                                            : ''
                                    }
                                    help={
                                        formState.errors.name?.message
                                    }
                                >
                                    <Input
                                        {...field}
                                        size="large"
                                        placeholder="Enter your name"
                                    />
                                </Form.Item>
                            )}
                        />

                        <Form.Item label="Email">
                            <Input
                                size="large"
                                value={user?.email || ''}
                                disabled
                            />
                            <Text
                                type="secondary"
                                className="mt-1 block text-xs"
                            >
                                Email address cannot be changed here.
                            </Text>
                        </Form.Item>
                    </div>
                </Card>


                {/* Actions */}
                <div className="flex justify-end">
                    <Button
                        type="primary"
                        htmlType="submit"
                        size="large"
                        icon={<SaveOutlined />}
                        loading={submitting}
                    >
                        Save Changes
                    </Button>
                </div>
            </Form>
        </div>
    );
}
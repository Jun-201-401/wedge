package com.wedge.evidence.infrastructure;

import java.net.URI;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.AwsCredentialsProvider;
import software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3ClientBuilder;

@Configuration
@ConditionalOnProperty(name = "wedge.artifacts.storage", havingValue = "s3")
public class S3ArtifactStorageConfig {
    @Bean
    public AwsCredentialsProvider artifactS3CredentialsProvider(
            @Value("${wedge.artifacts.s3.access-key-id:}") String accessKeyId,
            @Value("${wedge.artifacts.s3.secret-access-key:}") String secretAccessKey
    ) {
        boolean hasAccessKeyId = accessKeyId != null && !accessKeyId.isBlank();
        boolean hasSecretAccessKey = secretAccessKey != null && !secretAccessKey.isBlank();

        if (hasAccessKeyId != hasSecretAccessKey) {
            throw new IllegalStateException(
                    "wedge.artifacts.s3.access-key-id and wedge.artifacts.s3.secret-access-key must be set together"
            );
        }

        if (!hasAccessKeyId) {
            return DefaultCredentialsProvider.create();
        }
        return StaticCredentialsProvider.create(AwsBasicCredentials.create(accessKeyId, secretAccessKey));
    }

    @Bean
    public S3Client s3Client(
            ObjectProvider<AwsCredentialsProvider> credentialsProvider,
            @Value("${wedge.artifacts.s3.region:${aws.region}}") String region,
            @Value("${wedge.artifacts.s3.endpoint:}") String endpoint,
            @Value("${wedge.artifacts.s3.force-path-style:false}") boolean forcePathStyle
    ) {
        S3ClientBuilder builder = S3Client.builder()
                .credentialsProvider(credentialsProvider.getObject())
                .region(Region.of(region))
                .serviceConfiguration(S3Configuration.builder()
                        .pathStyleAccessEnabled(forcePathStyle)
                        .build());

        if (endpoint != null && !endpoint.isBlank()) {
            builder.endpointOverride(URI.create(endpoint));
        }

        return builder.build();
    }
}

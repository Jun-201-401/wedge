package com.wedge.common.openapi;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
public class OpenApiContractController {
    private static final String CONTRACT_RESOURCE = "static/openapi/wedge_openapi.yaml";
    private static final String CONTRACT_FILE = "packages/contracts/openapi/wedge_openapi.yaml";
    private static final String YAML_CONTENT_TYPE = "application/yaml; charset=UTF-8";

    @GetMapping(value = "/openapi/wedge_openapi.yaml", produces = YAML_CONTENT_TYPE)
    public ResponseEntity<Resource> getOpenApiContract() {
        Resource resource = resolveContractResource();
        return ResponseEntity.ok()
                .header(HttpHeaders.CACHE_CONTROL, "no-cache")
                .body(resource);
    }

    private Resource resolveContractResource() {
        Path workingDirectory = Path.of(System.getProperty("user.dir")).toAbsolutePath().normalize();
        List<Path> candidates = List.of(
                workingDirectory.resolve(CONTRACT_FILE).normalize(),
                workingDirectory.resolve("../../" + CONTRACT_FILE).normalize(),
                workingDirectory.resolve("../" + CONTRACT_FILE).normalize()
        );

        for (Path candidate : candidates) {
            if (Files.isRegularFile(candidate)) {
                return new FileSystemResource(candidate);
            }
        }

        ClassPathResource classPathResource = new ClassPathResource(CONTRACT_RESOURCE);
        if (classPathResource.exists()) {
            return classPathResource;
        }

        throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Wedge OpenAPI contract was not found.");
    }
}

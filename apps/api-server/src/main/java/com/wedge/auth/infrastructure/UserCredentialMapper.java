package com.wedge.auth.infrastructure;

import com.wedge.auth.domain.UserCredential;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.Optional;
import java.util.UUID;

@Mapper
public interface UserCredentialMapper {
    int insert(UserCredential credential);
    Optional<String> findPasswordHashByUserId(@Param("userId") UUID userId);
}

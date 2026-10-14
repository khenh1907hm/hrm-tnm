import { certificateTypeRepositoryContract, repositoryContract } from "../contract-tests/repositoryContract";
import { MemoryRepository } from "./repository";
import { SYSTEM_CERTIFICATE_TYPES } from "../../modules/certificate-types/types";

repositoryContract(() => new MemoryRepository());
certificateTypeRepositoryContract(() => new MemoryRepository(SYSTEM_CERTIFICATE_TYPES));

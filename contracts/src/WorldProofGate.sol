// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal EIP-712 gate for a World Proof Gateway issuer.
/// @dev A contract using this gate must call consume() before granting value.
/// The gateway signature is an explicit trust assumption, not an on-chain
/// verification of a World proof.
contract WorldProofGate {
    struct WorldProof {
        bytes32 project;
        bytes32 action;
        address subject;
        bytes32 nullifier;
        uint64 deadline;
        bytes32 nonce;
    }

    bytes32 private constant DOMAIN_TYPEHASH = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant PROOF_TYPEHASH = keccak256("WorldProof(bytes32 project,bytes32 action,address subject,bytes32 nullifier,uint64 deadline,bytes32 nonce)");
    bytes32 private constant NAME_HASH = keccak256("World Proof Gateway");
    bytes32 private constant VERSION_HASH = keccak256("1");

    address public immutable issuer;
    mapping(bytes32 => bool) public consumed;

    error Expired(); error WrongSubject(); error Used(); error InvalidIssuer();
    constructor(address issuer_) { issuer = issuer_; }

    function consume(WorldProof calldata proof, bytes calldata signature) external {
        if (proof.deadline < block.timestamp) revert Expired();
        if (proof.subject != msg.sender) revert WrongSubject();
        bytes32 digest = _digest(proof);
        if (consumed[digest]) revert Used();
        if (_recover(digest, signature) != issuer) revert InvalidIssuer();
        consumed[digest] = true;
    }

    function _digest(WorldProof calldata proof) internal view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(PROOF_TYPEHASH, proof.project, proof.action, proof.subject, proof.nullifier, proof.deadline, proof.nonce));
        bytes32 domain = keccak256(abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)));
        return keccak256(abi.encodePacked("\\x19\\x01", domain, structHash));
    }
    function _recover(bytes32 digest, bytes calldata sig) private pure returns (address recovered) {
        if (sig.length != 65) return address(0);
        bytes32 r; bytes32 s; uint8 v;
        assembly { r := calldataload(sig.offset) s := calldataload(add(sig.offset, 32)) v := byte(0, calldataload(add(sig.offset, 64))) }
        if (v < 27) v += 27;
        if (v != 27 && v != 28) return address(0);
        return ecrecover(digest, v, r, s);
    }
}
